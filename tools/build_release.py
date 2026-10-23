#!/usr/bin/env python3
"""Build a source-only unpacked Chrome extension ZIP without local state or dependencies."""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def build(destination: Path) -> Path:
    manifest = json.loads((ROOT / "manifest.json").read_text())
    version = manifest["version"]
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / f"유승빈 DB추출기 v{version}.zip"
    top = f"유승빈 DB추출기 v{version}"
    files = [ROOT / name for name in (
        "manifest.json", "README.md", "설치안내.txt", f"변경사항_v{version}.md",
        "QA_전체기능검사.md", f"검증결과_v{version}.md", "package.json", "package-lock.json", ".gitignore",
    )]
    for directory in ("src", "icons", "tests", "tools"):
        files.extend(p for p in (ROOT / directory).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    for name in (manifest["background"]["service_worker"], manifest["action"]["default_popup"]):
        if not (ROOT / name).is_file():
            raise ValueError(f"Missing extension entry: {name}")
    for entry in manifest.get("content_scripts", []):
        for name in entry.get("js", []) + entry.get("css", []):
            if not (ROOT / name).is_file():
                raise ValueError(f"Missing content script: {name}")
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for file in sorted(set(files)):
            output.write(file, f"{top}/{file.relative_to(ROOT).as_posix()}")
    with zipfile.ZipFile(archive) as check:
        if check.testzip() is not None:
            raise ValueError("Corrupt ZIP")
        if json.loads(check.read(f"{top}/manifest.json"))["version"] != version:
            raise ValueError("ZIP manifest version mismatch")
        for file in files:
            if check.read(f"{top}/{file.relative_to(ROOT).as_posix()}") != file.read_bytes():
                raise ValueError(f"ZIP source mismatch: {file}")
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(f"{checksum}  {archive.name}\n")
    print(f"{archive}\nfiles={len(set(files))}, bytes={archive.stat().st_size}, sha256={checksum}")
    return archive


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT.parent / "releases")
    build(parser.parse_args().output.resolve())
