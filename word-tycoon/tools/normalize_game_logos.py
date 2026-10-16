from __future__ import annotations

from pathlib import Path
from PIL import Image
from PIL import ImageFilter
from PIL import ImageStat
import shutil
import json


ROOT = Path(r"C:\Word Tycoon")
SOURCE_DIR = Path(r"C:\Users\johnr\Downloads\Remove background 2026-4-6 at 15_25_37\Remove background 2026-4-6 at 15_25_37")
OUT_DIR = ROOT / "logo-normalized"
RAW_DIR = OUT_DIR / "raw"
MASTER_DIR = OUT_DIR / "masters"
EXPORTS_DIR = OUT_DIR / "exports"

FILES = {
    "word5000": "Word5000LOGO_noBackground.png",
    "searchle": "SearchleLOGO_noBackground.png",
    "erectangled": "erecTangledLOGO_noBackground.png",
    "rectangled": "recTangledLOGO_noBackground.png",
    "figural": "FiguralLOGO_noBackground.png",
    "betwixt": "BETWIXTLOGO_noBackground.png",
}

EXPORT_SIZES = {
    "icon-1024.png": 1024,
    "icon-512.png": 512,
    "icon-192.png": 192,
    "apple-touch-icon.png": 180,
    "favicon-32.png": 32,
}

EDGE_SHAVE_PX = 2


def ensure_dirs() -> None:
    for path in (RAW_DIR, MASTER_DIR, EXPORTS_DIR):
        path.mkdir(parents=True, exist_ok=True)


def copy_raw() -> dict[str, Path]:
    copied: dict[str, Path] = {}
    for slug, name in FILES.items():
        src = SOURCE_DIR / name
        dst = RAW_DIR / f"{slug}.png"
        shutil.copy2(src, dst)
        copied[slug] = dst
    return copied


def unpremultiply_alpha(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    px = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = px[x, y]
            if 0 < a < 255:
                r = min(255, int(round(r * 255 / a)))
                g = min(255, int(round(g * 255 / a)))
                b = min(255, int(round(b * 255 / a)))
                px[x, y] = (r, g, b, a)
    return rgba


def alpha_bbox(img: Image.Image, threshold: int = 8) -> tuple[int, int, int, int] | None:
    alpha = img.getchannel("A")
    mask = alpha.point(lambda p: 255 if p > threshold else 0)
    return mask.getbbox()


def crop_to_visible(img: Image.Image, threshold: int = 8) -> Image.Image:
    bbox = alpha_bbox(img, threshold)
    if not bbox:
        return img
    return img.crop(bbox)


def make_square_master(img: Image.Image, size: int = 1024, inner_ratio: float = 0.97) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    max_inner = int(size * inner_ratio)
    w, h = img.size
    scale = min(max_inner / max(w, 1), max_inner / max(h, 1))
    new_size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    resized = img.resize(new_size, Image.Resampling.LANCZOS)
    x = (size - resized.width) // 2
    y = (size - resized.height) // 2
    canvas.alpha_composite(resized, (x, y))
    return canvas


def shave_alpha_edges(img: Image.Image, pixels: int = EDGE_SHAVE_PX) -> Image.Image:
    if pixels <= 0:
        return img
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    filter_size = max(3, pixels * 2 + 1)
    shaved = alpha.filter(ImageFilter.MinFilter(filter_size))
    rgba.putalpha(shaved)
    return rgba


def save_exports(master: Image.Image, slug: str) -> dict[str, str]:
    slug_dir = EXPORTS_DIR / slug
    slug_dir.mkdir(parents=True, exist_ok=True)
    written: dict[str, str] = {}
    for filename, size in EXPORT_SIZES.items():
        out_path = slug_dir / filename
        if size == master.width:
            export = master
        else:
            export = master.resize((size, size), Image.Resampling.LANCZOS)
        export.save(out_path, optimize=True)
        written[filename] = str(out_path)
    return written


def build_gallery(records: list[dict[str, object]]) -> None:
    html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Normalized Game Logos</title>
  <style>
    body{margin:0;padding:32px;background:#0f1322;color:#eef2ff;font:16px/1.5 Inter,Segoe UI,sans-serif}
    h1{margin:0 0 10px;font-size:34px}
    p{margin:0 0 24px;color:#b8c2dd}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px}
    .card{background:#171d31;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:18px}
    .card h2{margin:0 0 10px;font-size:22px;text-transform:capitalize}
    .meta{font-size:13px;color:#aab4d3;margin-bottom:14px}
    .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .shot{background:
      linear-gradient(45deg,#111827 25%,#0b1220 25%,#0b1220 50%,#111827 50%,#111827 75%,#0b1220 75%,#0b1220 100%);
      background-size:24px 24px;
      border-radius:14px;padding:14px;border:1px solid rgba(255,255,255,.06)}
    .shot strong{display:block;margin-bottom:10px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#ced6ef}
    .shot img{width:100%;height:auto;display:block}
    ul{margin:14px 0 0 18px;padding:0;color:#cad3ee;font-size:14px}
    code{color:#d9e1ff}
  </style>
</head>
<body>
  <h1>Normalized Game Logos</h1>
  <p>Originals are preserved in <code>raw</code>. Masters are cleaned, square, transparent PNGs sized for app-icon export. Exports are generated from the masters.</p>
  <div class="grid">
"""
    for record in records:
        html += f"""
    <section class="card">
      <h2>{record['slug']}</h2>
      <div class="meta">source: {record['source_size']} &middot; master: {record['master_size']}</div>
      <div class="pair">
        <div class="shot">
          <strong>Raw</strong>
          <img src="raw/{record['slug']}.png" alt="{record['slug']} raw">
        </div>
        <div class="shot">
          <strong>Normalized Master</strong>
          <img src="masters/{record['slug']}.png" alt="{record['slug']} normalized">
        </div>
      </div>
      <ul>
        <li>Exports: 1024, 512, 192, 180, 32</li>
        <li>Folder: <code>exports/{record['slug']}</code></li>
      </ul>
    </section>
"""
    html += """
  </div>
</body>
</html>
"""
    (OUT_DIR / "index.html").write_text(html, encoding="utf-8")


def main() -> None:
    ensure_dirs()
    copied = copy_raw()
    records: list[dict[str, object]] = []

    for slug, raw_path in copied.items():
        img = Image.open(raw_path).convert("RGBA")
        source_size = f"{img.width}x{img.height}"
        img = unpremultiply_alpha(img)
        img = crop_to_visible(img, threshold=8)
        master = make_square_master(img, size=1024, inner_ratio=0.97)
        master = shave_alpha_edges(master, EDGE_SHAVE_PX)
        master_path = MASTER_DIR / f"{slug}.png"
        master.save(master_path, optimize=True)
        exports = save_exports(master, slug)
        records.append({
            "slug": slug,
            "source_size": source_size,
            "master_size": f"{master.width}x{master.height}",
            "master": str(master_path),
            "exports": exports,
        })

    build_gallery(records)
    (OUT_DIR / "manifest.json").write_text(json.dumps(records, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
