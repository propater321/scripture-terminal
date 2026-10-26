import { version } from '../package.json';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerSchema, researchAnswerSchema, parseStudyAnswer, instructionsFor, studyPrompt, type StudyAssistant, type StudyTools } from './study';

type RpcMessage = { id?: number | string; method?: string; params?: any; result?: any; error?: { message: string } };
type Model = { model: string; displayName: string; isDefault: boolean; supportedReasoningEfforts: { reasoningEffort: string }[] };

// These are process-local overrides. Never read/copy auth.json or change the user's Codex config.
const overrides = [
  'model_provider="openai"',
  'sandbox_mode="read-only"', 'approval_policy="never"', 'web_search="disabled"',
  'features.shell_tool=false', 'features.unified_exec=false', 'features.apps=false',
  'features.plugins=false', 'features.hooks=false', 'features.multi_agent=false',
  'features.goals=false', 'features.memories=false', 'features.browser_use=false',
  'features.computer_use=false', 'features.image_generation=false', 'features.view_image=false',
  'features.shell_snapshot=false', 'tools.view_image=false', 'project_doc_max_bytes=0',
  'developer_instructions=""', 'model_reasoning_effort="medium"', 'skills.include_instructions=false',
];

class AppServer {
  private process: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(message: RpcMessage) => void>();
  private terminalError?: Error;
  private stopped = false;
  private abort = () => this.close(new Error('Stopped.'));
  private onExit = () => { this.process.kill('SIGTERM'); };

  constructor(cwd: string, private signal: AbortSignal, private bibleTools?: StudyTools) {
    if (signal.aborted) throw new Error('Stopped.');
    const env = { ...process.env };
    // A subscription-only provider must never silently fall back to metered credentials.
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL']) delete env[key];
    this.process = spawn('codex', ['app-server', '--listen', 'stdio://', ...overrides.flatMap(value => ['-c', value])], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.process.stderr.on('data', () => {}); // Keep server diagnostics (which may contain account data) out of the UI.
    this.process.stdin.on('error', () => this.fail(new Error('Lost the local Codex connection. Please try again.')));
    createInterface({ input: this.process.stdout }).on('line', line => {
      let message: RpcMessage;
      try { message = JSON.parse(line); } catch { return; }
      if (typeof message.id === 'number' && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
      } else if (message.method && message.id !== undefined) {
        if (message.method === 'item/tool/call' && this.bibleTools && !message.params?.namespace) {
          void this.bibleTools.call(message.params.tool, message.params.arguments).then(result => {
            this.send({ id: message.id, result: { contentItems: [{ type: 'inputText', text: JSON.stringify(result) }], success: true } });
          }, error => {
            this.send({ id: message.id, result: { contentItems: [{ type: 'inputText', text: (error as Error).message }], success: false } });
          });
          return;
        }
        // This client has no approval/tool UI. Fail closed instead of leaving a tool request hanging.
        this.send({ id: message.id, error: { code: -32601, message: 'Tools and approval requests are unavailable in Scripture.' } });
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
    this.process.on('error', (error: NodeJS.ErrnoException) => this.fail(new Error(error.code === 'ENOENT' ? 'Install the Codex CLI, then run codex login in your terminal.' : 'Could not start the local Codex connection.')));
    this.process.on('exit', () => { if (!this.stopped) this.fail(new Error('Codex stopped unexpectedly. Check codex login status, then try again.')); });
    signal.addEventListener('abort', this.abort, { once: true });
    process.once('exit', this.onExit);
  }

  private send(message: unknown) { if (!this.stopped) this.process.stdin.write(JSON.stringify(message) + '\n'); }
  private fail(error: Error) {
    if (this.terminalError) return;
    this.terminalError = error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: 'client/error', params: { error } });
  }
  request<T = any>(method: string, params: unknown): Promise<T> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error('Codex took too long to respond. Please try again.'));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'scripture_terminal', title: 'Scripture Terminal', version }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized', params: {} });
  }
  async identity() {
    const { account, requiresOpenaiAuth } = await this.request('account/read', { refreshToken: false });
    if (!account) throw new Error('Sign in with your ChatGPT subscription: run codex login in a terminal, then try again.');
    if (account.type !== 'chatgpt' || !requiresOpenaiAuth) throw new Error('Ask requires a ChatGPT subscription login. Run codex login and choose ChatGPT. API billing is not enabled here.');
    const { data } = await this.request<{ data: Model[] }>('model/list', { includeHidden: false, limit: 100 });
    const model = data.find(model => model.model === 'gpt-6.1-sol') ?? data.find(model => model.isDefault) ?? data[0];
    if (!model) throw new Error('No Codex model is available for this account.');
    return { plan: String(account.planType ?? 'subscription'), model };
  }
  async answer(threadId: string, prompt: string, effort: string, onWriting: () => void, schema: unknown = answerSchema): Promise<string> {
    if (this.terminalError) throw this.terminalError;
    return new Promise((resolve, reject) => {
      const messages = new Map<string, string>();
      const finish = (error?: Error, text?: string) => {
        clearTimeout(timer); this.listeners.delete(listener);
        if (error) reject(error); else resolve(text ?? '');
      };
      const listener = (message: RpcMessage) => {
        const params = message.params;
        if (message.method === 'client/error') return finish(params.error);
        if (params?.threadId !== threadId) return;
        if (message.method === 'item/agentMessage/delta') {
          messages.set(params.itemId, (messages.get(params.itemId) ?? '') + params.delta); onWriting();
        }
        if (message.method === 'item/completed' && params.item?.type === 'agentMessage') messages.set(params.item.id, params.item.text);
        if (message.method === 'turn/completed') {
          if (params.turn.status !== 'completed') finish(new Error(params.turn.error?.message ?? 'Codex could not finish the answer. Please try again.'));
          else {
            const final = params.turn.items?.filter((item: any) => item.type === 'agentMessage').at(-1)?.text;
            finish(undefined, final ?? [...messages.values()].at(-1));
          }
        }
      };
      const timer = setTimeout(() => { finish(new Error('The answer timed out. Please try a shorter question.')); this.close(); }, this.bibleTools ? 180_000 : 120_000);
      this.listeners.add(listener);
      this.request('turn/start', { threadId, input: [{ type: 'text', text: prompt, text_elements: [] }], effort, outputSchema: schema, serviceTierForTurn: 'default' }).catch(error => finish(error));
    });
  }
  close(error = new Error('Codex connection closed.')) {
    if (this.stopped) return;
    this.fail(error); this.stopped = true;
    this.signal.removeEventListener('abort', this.abort);
    process.removeListener('exit', this.onExit);
    this.process.stdin.end(); this.process.kill('SIGTERM');
    const force = setTimeout(() => { if (this.process.exitCode === null && this.process.signalCode === null) this.process.kill('SIGKILL'); }, 1500);
    force.unref();
  }
}

export const askCodex: StudyAssistant = async (request, signal, onProgress) => {
  if (!request.question || request.question.length > 4000) throw new Error('Please enter a question of 1–4,000 characters.');
  const cwd = await mkdtemp(join(tmpdir(), 'scripture-ask-'));
  let server: AppServer | undefined;
  try {
    onProgress({ status: 'Connecting to your Codex subscription…' });
    server = new AppServer(cwd, signal, request.tools);
    await server.initialize();
    const { model, plan } = await server.identity();
    onProgress({ status: 'Reading the supplied passages…', model: model.model, plan });
    // Disable each inherited MCP server, including configurations merged from the user's home.
    const { config } = await server.request('config/read', { includeLayers: false, cwd });
    const threadConfig: Record<string, unknown> = {};
    for (const name of Object.keys(config.mcp_servers ?? {})) {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Ask cannot isolate an inherited Codex tool configuration on this installation.');
      threadConfig[`mcp_servers.${name}.enabled`] = false;
    }
    const instructions = instructionsFor(request);
    const { thread, model: actualModel, modelProvider } = await server.request('thread/start', {
      model: model.model, modelProvider: 'openai', cwd, approvalPolicy: 'never', sandbox: 'read-only',
      ephemeral: true, baseInstructions: instructions, developerInstructions: instructions,
      ...(request.tools ? { dynamicTools: request.tools.definitions } : {}),
      config: threadConfig, serviceName: 'scripture_terminal',
    });
    if (modelProvider !== 'openai') throw new Error('Ask could not verify the subscription provider.');
    const effort = model.supportedReasoningEfforts.some(option => option.reasoningEffort === 'medium') ? 'medium' : model.supportedReasoningEfforts[0]?.reasoningEffort ?? 'low';
    let writing = false;
    const raw = await server.answer(thread.id, studyPrompt(request), effort, () => {
      if (!writing) { writing = true; onProgress({ status: 'Writing an answer with verse sources…', model: actualModel, plan }); }
    }, request.scope === 'bible' ? researchAnswerSchema : answerSchema);
    return { ...parseStudyAnswer(raw, request), model: actualModel, plan, searches: request.searches };
  } finally {
    server?.close();
    await rm(cwd, { recursive: true, force: true });
  }
};
