/**
 * Samples distinct greens from `assets/reference-chrome-greens.png` (1024×682).
 * Run: `npx tsx scripts/sample-reference-greens.ts [path-to-image]`
 *
 * Method: sharp raw RGB + heuristics documented in stdout JSON.
 * Values are mirrored in `app/globals.css` (comment + --ref-* tokens).
 */
import sharp from "sharp";
import path from "node:path";

type Rgb = { r: number; g: number; b: number };

function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function meanMasked(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  predicate: (r: number, g: number, b: number) => boolean,
): Rgb | null {
  let sr = 0,
    sg = 0,
    sb = 0,
    n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i]!,
        g = data[i + 1]!,
        b = data[i + 2]!;
      if (!predicate(r, g, b)) continue;
      sr += r;
      sg += g;
      sb += b;
      n++;
    }
  }
  if (!n) return null;
  return { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) };
}

async function main() {
  const imagePath = path.resolve(
    process.argv[2] ?? path.join(process.cwd(), "assets/reference-chrome-greens.png"),
  );
  const img = sharp(imagePath);
  const meta = await img.metadata();
  const full = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = full;
  const W = info.width;
  const H = info.height;
  const ch = info.channels;

  // Logo tile (sidebar): tight box; exclude navy chrome (low G).
  const logoBuf = await sharp(imagePath)
    .extract({ left: 14, top: 22, width: 48, height: 48 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const logoRgb = meanMasked(
    logoBuf.data,
    logoBuf.info.width,
    logoBuf.info.height,
    logoBuf.info.channels,
    (r, g) => g > 90 && g > r + 8,
  );

  // Sidebar footer avatar interior (mint).
  const sbBuf = await sharp(imagePath)
    .extract({ left: 21, top: 576, width: 28, height: 28 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sbRgb = meanMasked(
    sbBuf.data,
    sbBuf.info.width,
    sbBuf.info.height,
    sbBuf.info.channels,
    (r, g, b) => g > r && g > b && r > 70 && b > 70,
  );

  // Header avatar interior.
  const hdBuf = await sharp(imagePath)
    .extract({ left: 913, top: 7, width: 32, height: 32 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hdRgb = meanMasked(
    hdBuf.data,
    hdBuf.info.width,
    hdBuf.info.height,
    hdBuf.info.channels,
    (r, g, b) => g > r && g > b && r > 90,
  );

  // Average avatar fill (single app token).
  let avatarAvg: Rgb | null = null;
  if (sbRgb && hdRgb) {
    avatarAvg = {
      r: Math.round((sbRgb.r + hdRgb.r) / 2),
      g: Math.round((sbRgb.g + hdRgb.g) / 2),
      b: Math.round((sbRgb.b + hdRgb.b) / 2),
    };
  }

  // Row / table wash: very pale mint in main grid (heuristic scan).
  let tr = 0,
    tg = 0,
    tb = 0,
    tn = 0;
  for (let y = Math.floor(H * 0.4); y < Math.floor(H * 0.7); y++) {
    for (let x = Math.floor(W * 0.25); x < Math.floor(W * 0.85); x++) {
      const i = (y * W + x) * ch;
      const r = data[i]!,
        g = data[i + 1]!,
        b = data[i + 2]!;
      if (r > 210 && g > 218 && b > 210 && g > r + 2 && g > b + 2 && g - r < 25) {
        tr += r;
        tg += g;
        tb += b;
        tn++;
      }
    }
  }
  const rowTintRgb =
    tn > 0
      ? {
          r: Math.round(tr / tn),
          g: Math.round(tg / tn),
          b: Math.round(tb / tn),
        }
      : { r: 248, g: 253, b: 248 };

  const out = {
    source: imagePath,
    imageSize: { width: W, height: H },
    format: meta.format,
    sampledAt: new Date().toISOString().slice(0, 10),
    logoTile_maskedMean_srgb: logoRgb,
    logoTile_hex: logoRgb ? toHex(logoRgb) : null,
    sidebarAvatar_maskedMean_srgb: sbRgb,
    sidebarAvatar_hex: sbRgb ? toHex(sbRgb) : null,
    headerAvatar_maskedMean_srgb: hdRgb,
    headerAvatar_hex: hdRgb ? toHex(hdRgb) : null,
    avatarToken_meanOfSidebarAndHeader_srgb: avatarAvg,
    avatarToken_hex: avatarAvg ? toHex(avatarAvg) : null,
    rowSelectionTint_softMint_mean_srgb: rowTintRgb,
    rowSelectionTint_hex: toHex(rowTintRgb),
    archivedForest_srgb: null as Rgb | null,
    notes:
      "No isolated high-chroma forest glyph was found in the table body; --ref-status-archived in CSS is hue-aligned to the logo token (oklch), not a direct masked mean.",
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
