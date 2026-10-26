import { releaseFiles, validateReleaseFiles, root } from './release-files';
import { join } from 'node:path';
const files=await releaseFiles();await validateReleaseFiles(files);
for(const file of ['LICENSE','NOTICE.md','SECURITY.md','README.md','CHANGELOG.md','bun.lock','.github/workflows/ci.yml'])if(!files.includes(file))throw new Error(`Missing release file: ${file}`);
for(const command of [[process.execPath,'run','check'],[process.execPath,'run','test:unit'],['python3','-m','unittest','discover','-s','tests/python','-p','test_*.py']]){
 const result=await Bun.spawn(command,{cwd:root,stdout:'inherit',stderr:'inherit'}).exited;if(result)process.exit(result);
}
const pkg=await Bun.file(join(root,'package.json')).json();
if(pkg.license!=='MIT'||!pkg.version||Object.values({...pkg.dependencies,...pkg.devDependencies}).some(v=>!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(v))))throw new Error('Release metadata or direct dependency pins are incomplete.');
console.log(`Release source check passed: ${files.length} files; no generated data, credential patterns, or machine-specific paths found. This is a heuristic scan, not a security guarantee.`);
