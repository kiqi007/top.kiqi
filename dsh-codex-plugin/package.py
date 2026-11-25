"""Assemble the built Web plugin and its offline runtime dependency."""
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent
FILES = ('package.json', 'cordis.patch.yml', 'host.js', 'local-endpoint.js',
         'workspace-file.js', 'client.js')


def main():
    output = ROOT / 'bin'
    output.mkdir(exist_ok=True)
    dependency = ROOT / 'node_modules/ws'
    if not (dependency / 'package.json').is_file():
        raise SystemExit('Run make deps in dsh-codex-plugin first.')
    with tempfile.TemporaryDirectory(dir=output) as tmp:
        artifact = Path(tmp) / 'dsh-codex-plugin.zip'
        with ZipFile(artifact, 'w', ZIP_DEFLATED) as archive:
            files = [ROOT / name for name in FILES]
            files.extend(sorted(path for path in dependency.rglob('*') if path.is_file()))
            for path in files:
                archive.write(path, 'dsh-codex-plugin/' + path.relative_to(ROOT).as_posix())
        print(artifact.replace(output / artifact.name))


if __name__ == '__main__':
    main()
