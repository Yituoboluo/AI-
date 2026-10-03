from pathlib import Path
import sys
sys.path.insert(0, str(Path.cwd()/'draft_a3706042_folder'))
from build_skill_prd import convert
convert(Path.cwd()/'交付文档'/'造物营_PRD_Skill标准版_V1.0_待确认项.md', Path.cwd()/'draft_5453e3e3_folder'/'draft.xml')
