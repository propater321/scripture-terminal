import importlib.util,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('jewish_import',ROOT/'scripts/import-jewish.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class ImportTests(unittest.TestCase):
 def test_notes_are_not_silently_inserted_into_main_text(self):
  p=mod.Text();p.feed('Main<sup class="footnote-marker">1</sup><i class="footnote">Edition note <b>with formatting</b>.</i> text &amp; more.');main,notes=p.result()
  self.assertEqual(main,'Main text & more.');self.assertEqual(notes,'Edition note with formatting.')
 def test_terminal_controls_are_removed(self):
  p=mod.Text();p.feed('Text\x1b\x07\x9b\u202eend');main,_=p.result();self.assertEqual(main,'Textend')
 def test_daf_amud_offsets_include_empty_opening_leaves(self):
  rows=list(mod.flatten([[],[],['First'],['Second']],2,['Talmud','Integer']))
  self.assertEqual(rows,[(('2a','1'),'First'),(('2b','1'),'Second')])
 def test_default_node_does_not_gain_a_fake_reference_component(self):
  root={'nodes':[{'default':True,'depth':2,'addressTypes':['Integer','Integer']},{'key':'Introduction','depth':1,'addressTypes':['Integer']} ]}
  leaves=list(mod.leaves(root));self.assertEqual(leaves[0][0],());self.assertEqual(leaves[1][0],('Introduction',))
 def test_hebrew_normalization_preserves_consonants(self):
  self.assertEqual(mod.normalize('בְּרֵאשִׁית'),'בראשית')
if __name__=='__main__':unittest.main()
