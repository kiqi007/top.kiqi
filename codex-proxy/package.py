"""Build the offline dsh plugin and the native Codex proxies for macOS and Windows."""
import argparse
import os
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent
PLUGIN = ROOT.parent / 'dsh-codex-plugin'
PLATFORMS = {'mac': 'darwin', 'windows': 'windows'}


def package(platform, staging, plugin_archive):
    filename = f'dsh-codex-{platform}.zip'
    name = 'codex-proxy.exe' if platform == 'windows' else 'codex-proxy'
    with ZipFile(staging / filename, 'w', ZIP_DEFLATED) as archive:
        for arch in ('amd64', 'arm64'):
            env = dict(os.environ, GOOS=PLATFORMS[platform], GOARCH=arch, CGO_ENABLED='0')
            binary = staging / name
            subprocess.run([os.environ.get('GO', 'go'), 'build', '-trimpath', '-o', str(binary), '.'],
                           cwd=ROOT, env=env, check=True)
            entry = ZipInfo.from_file(binary, f'bin/{arch.upper()}/{name}')
            # Preserve the macOS executable bit even when packaging on Windows.
            entry.create_system = 3
            entry.external_attr = 0o100755 << 16
            archive.writestr(entry, binary.read_bytes(), compress_type=ZIP_DEFLATED)
        with ZipFile(plugin_archive) as plugin:
            for entry in plugin.infolist():
                archive.writestr(entry, plugin.read(entry))
        archive.write(ROOT / platform / 'README.md', 'README.md')
        if platform == 'mac':
            archive.write(ROOT / 'mac/Makefile', 'Makefile')
    return staging / filename


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform', nargs='?', default='all', choices=['all', *PLATFORMS])
    parser.add_argument('--plugin-archive', type=Path, help='Use an already built plugin package')
    args = parser.parse_args()
    target = args.platform
    plugin_archive = args.plugin_archive
    if plugin_archive is None:
        subprocess.run(['make', 'package'], cwd=PLUGIN, check=True)
        plugin_archive = PLUGIN / 'bin/dsh-codex-plugin.zip'
    output = ROOT / 'bin'
    output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output) as tmp:
        targets = PLATFORMS if target == 'all' else [target]
        packages = [package(platform, Path(tmp), plugin_archive) for platform in targets]
        for artifact in packages:
            print(artifact.replace(output / artifact.name))


if __name__ == '__main__':
    main()
