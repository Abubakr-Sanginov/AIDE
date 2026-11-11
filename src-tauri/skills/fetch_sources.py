"""Refresh reviewed text-only skill snapshots; never executes upstream code."""
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
SOURCES = [
    ('anthropics/skills', 'frontend-design', 'skills/frontend-design/SKILL.md', 'skills/frontend-design/LICENSE.txt'),
    ('anthropics/skills', 'webapp-testing', 'skills/webapp-testing/SKILL.md', 'skills/frontend-design/LICENSE.txt'),
]

def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'AIDE-skill-snapshots'}), timeout=30) as response:
        data = response.read(200001)
    if len(data) > 200000:
        raise ValueError('Source exceeds text snapshot limit')
    data.decode('utf-8')
    return data

notes = ['# Bundled skill sources', '', 'Text-only upstream snapshots from https://skills.sh/. No upstream scripts are executed.', 'Run this script manually to refresh, then review changes and licenses before release.', '']
for repo, name, skill, license_path in SOURCES:
    commit = json.loads(fetch(f'https://api.github.com/repos/{repo}/commits/HEAD'))['sha']
    folder = ROOT / name
    folder.mkdir(parents=True, exist_ok=True)
    for source, target in [(skill, 'SKILL.md'), (license_path, 'LICENSE.txt')]:
        url = f'https://raw.githubusercontent.com/{repo}/{commit}/{source}'
        data = fetch(url)
        (folder / target).write_bytes(data)
        notes += [f'- `{name}/{target}`: {url}', f'  SHA256: `{hashlib.sha256(data).hexdigest()}`']
    notes += [f'  Directory: https://skills.sh/{repo}/{name}', '']
(ROOT / 'SOURCES.md').write_text('\n'.join(notes) + '\n', encoding='utf-8')
print('\n'.join(notes))
