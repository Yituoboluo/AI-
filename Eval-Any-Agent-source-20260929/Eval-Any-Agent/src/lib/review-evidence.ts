import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { ReviewError } from "./manual-review";

type EvidenceFile = { key: string; label: string; title: string; filePath: string; sha256?: string };

export function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return objectValue(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function collectEvidence(inputValue: unknown, outputValue: unknown): EvidenceFile[] {
  const input = objectValue(inputValue);
  const outputs = objectValue(outputValue);
  const actual = objectValue(outputs["实际输出"]);
  const files: EvidenceFile[] = [];
  if (typeof input.asset_path === "string" && input.asset_path.trim()) {
    files.push({ key: "input", label: "商品原图", title: "", filePath: input.asset_path, sha256: typeof input.asset_sha256 === "string" ? input.asset_sha256 : undefined });
  }
  if (Array.isArray(actual.assets)) {
    actual.assets.forEach((value, index) => {
      const asset = objectValue(value);
      if (typeof asset.local_path !== "string" || !asset.local_path.trim()) return;
      files.push({ key: `asset-${index}`, label: typeof asset.name === "string" ? asset.name : `成品 ${index + 1}`, title: typeof asset.title === "string" ? asset.title : "", filePath: asset.local_path, sha256: typeof asset.sha256 === "string" ? asset.sha256 : undefined });
    });
  }
  return files;
}

export function evidenceRoots() {
  const workspace = path.resolve(process.cwd(), "../..");
  return [path.join(workspace, "素材"), path.join(workspace, "outputs"), path.resolve(process.cwd(), "evidence")];
}

function within(filePath: string, root: string) {
  const relative = path.relative(root, filePath);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function readEvidenceFile(file: EvidenceFile, roots = evidenceRoots()) {
  const requested = path.resolve(file.filePath);
  if (!roots.some((root) => within(requested, path.resolve(root)))) throw new ReviewError("图片不在本机证据目录内", 403);
  let canonical: string;
  try { canonical = await realpath(requested); } catch { throw new ReviewError("证据图片不存在，请检查原素材目录", 404); }
  const canonicalRoots = await Promise.all(roots.map((root) => realpath(root).catch(() => null)));
  if (!canonicalRoots.some((root) => root !== null && within(canonical, root))) throw new ReviewError("图片不在本机证据目录内", 403);
  if (!/\.(png|jpe?g|webp|gif)$/i.test(canonical)) throw new ReviewError("不支持该证据图片格式", 415);
  const handle = await open(canonical, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > 20 * 1024 * 1024) throw new ReviewError("证据图片为空或超过 20MB", 413);
    const bytes = await handle.readFile();
    let contentType: string;
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) contentType = "image/png";
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) contentType = "image/jpeg";
    else if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) contentType = "image/gif";
    else if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") contentType = "image/webp";
    else throw new ReviewError("证据文件不是可显示的图片", 415);
    if (file.sha256 && (!/^[a-f0-9]{64}$/i.test(file.sha256) || createHash("sha256").update(bytes).digest("hex") !== file.sha256.toLowerCase())) {
      throw new ReviewError("图片已变化，与本次评测记录不一致", 409);
    }
    return { bytes, contentType };
  } finally { await handle.close(); }
}
