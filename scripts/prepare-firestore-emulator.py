"""Install the official Google Cloud SDK Firestore emulator with SHA-256 verification.

This is a distinct distribution from the Firebase CLI executable JAR. It is run
with its documented Java class, without altering Firebase CLI checksums.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tarfile
import tempfile
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--archive', help='Optional already-downloaded official SDK component archive')
args = parser.parse_args()
cache = Path('.data/firebase-emulators')
cache.mkdir(parents=True, exist_ok=True)
jar = cache / 'gcloud-firestore-emulator.jar'
manifest = cache / 'verified.json'
version = json.loads(Path('node_modules/firebase-tools/lib/emulator/downloadableEmulatorInfo.json').read_text())['firestore']['version']
if jar.exists() and manifest.exists():
    saved = json.loads(manifest.read_text())
    if saved.get('version') == version and hashlib.sha256(jar.read_bytes()).hexdigest() == saved.get('jar_sha256'):
        print('Émulateur officiel Google Cloud SDK déjà vérifié : ' + version)
        raise SystemExit(0)
with urllib.request.urlopen('https://dl.google.com/dl/cloudsdk/channels/rapid/components-2.json', timeout=30) as response:
    component = next(c for c in json.load(response)['components'] if c['id'] == 'cloud-firestore-emulator')
if component['version']['version_string'] != version:
    raise RuntimeError('La version du SDK Google et celle attendue par Firebase CLI diffèrent. Utiliser le téléchargement normal de Firebase CLI.')
url = 'https://dl.google.com/dl/cloudsdk/channels/rapid/' + component['data']['source']
temporary = None
try:
    if args.archive:
        archive = Path(args.archive)
    else:
        with tempfile.NamedTemporaryFile(dir=cache, suffix='.tar.gz', delete=False) as output:
            temporary = Path(output.name)
            with urllib.request.urlopen(url, timeout=60) as response:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
        archive = temporary
    if hashlib.sha256(archive.read_bytes()).hexdigest() != component['data']['checksum']:
        raise RuntimeError('Échec de vérification SHA-256 de l’archive officielle ; aucun binaire utilisé.')
    with tarfile.open(archive) as package:
        members = [m for m in package.getmembers() if m.isfile() and m.name.endswith('.jar')]
        if len(members) != 1:
            raise RuntimeError('Archive inattendue : un seul JAR officiel est requis.')
        binary = package.extractfile(members[0]).read()
    staging = jar.with_suffix('.new')
    staging.write_bytes(binary)
    os.replace(staging, jar)
    manifest.write_text(json.dumps({'version': version, 'source': url, 'archive_sha256': component['data']['checksum'], 'jar_sha256': hashlib.sha256(binary).hexdigest()}, indent=2) + '\n')
    print('Émulateur officiel Google Cloud SDK ' + version + ' installé, archive SHA-256 vérifiée.')
finally:
    if temporary:
        temporary.unlink(missing_ok=True)
