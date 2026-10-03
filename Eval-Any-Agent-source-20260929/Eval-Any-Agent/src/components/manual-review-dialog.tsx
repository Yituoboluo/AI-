"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ExternalLink, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import { REVIEW_LABELS, type EvidenceImage, type ReviewDetail, type ReviewRecord, type ReviewVerdict } from "@/lib/review-types";

function EvidenceView({ image }: { image: EvidenceImage }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="min-w-0 space-y-2">
      <figcaption className="flex items-center justify-between gap-2 text-sm font-medium">
        <span>{image.label}</span>
        <a href={image.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-4">
          查看大图 <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </figcaption>
      <div className="flex h-72 items-center justify-center overflow-hidden rounded-md border bg-white lg:h-96">
        {failed ? (
          <div role="status" className="flex max-w-56 flex-col items-center gap-2 p-4 text-center text-sm text-muted-foreground">
            <ImageOff className="size-6" aria-hidden="true" />
            <p>图片未能读取。点击“查看大图”可查看原因，再检查本机证据文件。</p>
          </div>
        ) : (
          /* Recorded local evidence needs the authenticated, hash-checked endpoint. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url} alt={image.label} onError={() => setFailed(true)} className="h-full w-full object-contain" />
        )}
      </div>
      {image.title ? <p className="break-words text-sm text-muted-foreground">成品标题：{image.title}</p> : null}
    </figure>
  );
}

function passLabel(value: boolean | null) { return value == null ? "未评估" : value ? "通过" : "未通过"; }

export function ManualReviewDialog({ resultId, onClose, onSaved }: {
  resultId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [assetKey, setAssetKey] = useState("");
  const [verdict, setVerdict] = useState<ReviewVerdict | "">("");
  const [reason, setReason] = useState("");
  const [correctedPassed, setCorrectedPassed] = useState("unchanged");
  const [correctedScore, setCorrectedScore] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [submissionKey, setSubmissionKey] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const verdictRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    api<ReviewDetail>(`/api/evaluation-results/${resultId}/reviews`)
      .then((data) => { if (active) { setDetail(data); setLoadError(""); } })
      .catch((error: Error) => { if (active) setLoadError(error.message); });
    return () => { active = false; };
  }, [resultId, loadAttempt]);

  function changed() { setSaved(false); setSaveError(""); setSubmissionKey(""); }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!detail || !verdict || !reason.trim() || saving) return;
    setSaving(true);
    setSaveError("");
    const key = submissionKey || crypto.randomUUID();
    setSubmissionKey(key);
    try {
      const record = await api<ReviewRecord>(`/api/evaluation-results/${resultId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionKey: key, expectedVersion: detail.reviewVersion, verdict, reason,
          correctedPassed: verdict === "incorrect" && correctedPassed !== "unchanged" ? correctedPassed === "true" : null,
          correctedScore: verdict === "incorrect" && correctedScore.trim() ? Number(correctedScore) : null,
        }),
      });
      setDetail({ ...detail, reviewVersion: record.revision, reviews: [record, ...detail.reviews.filter((item) => item.id !== record.id)] });
      setSaved(true);
      toast.success("人工复核已保存");
      onSaved();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }

  const input = detail?.images.find((image) => image.key === "input");
  const assets = detail?.images.filter((image) => image.key !== "input") ?? [];
  const selected = assets.find((image) => image.key === assetKey) ?? assets[0];
  const latest = detail?.reviews[0];
  const caseName = detail ? [detail.sourceInput.case_id, detail.sourceInput.name].filter((item) => typeof item === "string").join(" · ") || `第 ${detail.rowIndex + 1} 条` : "加载中";

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-7xl" showCloseButton={!saving}
        onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader className="border-b px-5 py-4 text-left">
          <DialogTitle className="pr-6 leading-snug">人工复核 · {caseName}</DialogTitle>
          <DialogDescription>对照证据，判断本条 AI 判分是否正确。填写理由后保存。</DialogDescription>
          {detail ? <Button type="button" size="sm" variant="outline" className="w-fit lg:hidden" disabled={saving} onClick={() => {
            formRef.current?.scrollIntoView({ block: "start" });
            verdictRef.current?.focus({ preventScroll: true });
          }}>填写判断</Button> : null}
        </DialogHeader>
        {!detail ? (
          <div className="overflow-y-auto p-5">
            {loadError ? <div role="alert" className="space-y-3"><p>{loadError}</p><Button variant="outline" onClick={() => setLoadAttempt((value) => value + 1)}>重新加载</Button></div>
              : <div aria-label="正在加载复核证据" className="grid gap-4 md:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>}
          </div>
        ) : (
          <div className="grid min-h-0 gap-6 overflow-y-auto p-5 lg:grid-cols-[3fr_2fr]">
            <div className="min-w-0 space-y-5">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">本条要求</h2>
                <p className="break-words text-sm leading-relaxed">{typeof detail.sourceInput.expectation === "string" ? detail.sourceInput.expectation : "对照下方输入、输出与评分标准核对。"}</p>
              </div>
              {assets.length > 1 ? <div className="flex flex-wrap gap-2" aria-label="选择生成成品">
                {assets.map((image) => <Button key={image.key} type="button" size="sm" variant={image.key === selected?.key ? "default" : "outline"} aria-pressed={image.key === selected?.key} onClick={() => setAssetKey(image.key)}>{image.label}</Button>)}
              </div> : null}
              {input || selected ? <div className={`grid gap-4 ${input && selected ? "sm:grid-cols-2" : ""}`}>
                {input ? <EvidenceView key={input.key} image={input} /> : null}
                {selected ? <EvidenceView key={selected.key} image={selected} /> : null}
              </div> : <p className="rounded-md border bg-muted/30 p-4 text-sm">本条没有可显示的图片证据。边界用例可根据请求、错误码和输出记录进行复核。</p>}
              <details className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer font-medium">查看输入与输出记录</summary>
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ input: detail.sourceInput, output: detail.sourceOutputs }, null, 2)}</pre>
              </details>
              <details className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer font-medium">查看 AI 评分标准</summary>
                <p className="mt-3 whitespace-pre-wrap break-words leading-relaxed">{detail.evaluator.systemPrompt}</p>
              </details>
            </div>
            <div className="min-w-0 space-y-5">
              <section className="space-y-2" aria-label="原始 AI 判分">
                <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">AI 判分</h2><span className="text-lg font-semibold tabular-nums">{detail.score ?? "—"} 分</span><Badge variant={detail.passed === false ? "destructive" : "secondary"}>{passLabel(detail.passed)}</Badge></div>
                <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{detail.reason || "本条没有 AI 判分理由，请核对执行状态和原始记录。"}</p>
                <p className="text-xs text-muted-foreground">{detail.evaluator.name} · 分值 {detail.evaluator.scoreMin}–{detail.evaluator.scoreMax}</p>
              </section>
              <form ref={formRef} onSubmit={save} className="space-y-4 border-t pt-5">
                <fieldset disabled={saving} className="space-y-2">
                  <legend className="mb-2 text-sm font-semibold">你的判断</legend>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(REVIEW_LABELS) as ReviewVerdict[]).map((value) => (
                      <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring ${verdict === value ? "border-foreground bg-muted font-medium" : "hover:bg-muted/50"}`}>
                        <input ref={value === (verdict || "correct") ? verdictRef : undefined} type="radio" name="review-verdict" value={value} checked={verdict === value} onChange={() => { setVerdict(value); changed(); }} className="accent-foreground" />{REVIEW_LABELS[value]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="space-y-2">
                  <Label htmlFor="review-reason">复核理由 <span className="text-muted-foreground">（必填）</span></Label>
                  <Textarea id="review-reason" value={reason} disabled={saving} maxLength={4000} rows={4} placeholder="写明哪项判分正确或有误，并指出图片、文案或记录中的依据。" onChange={(event) => { setReason(event.target.value); changed(); }} required />
                </div>
                {verdict === "incorrect" ? <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="corrected-passed">人工通过结论（选填）</Label>
                    <Select value={correctedPassed} disabled={saving} onValueChange={(value) => { setCorrectedPassed(value); changed(); }}><SelectTrigger id="corrected-passed" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unchanged">暂不修正</SelectItem><SelectItem value="true">应当通过</SelectItem><SelectItem value="false">应当未通过</SelectItem></SelectContent></Select>
                  </div>
                  <div className="space-y-2"><Label htmlFor="corrected-score">人工分数（选填）</Label><Input id="corrected-score" type="number" min={detail.evaluator.scoreMin} max={detail.evaluator.scoreMax} step="any" value={correctedScore} disabled={saving} placeholder={`${detail.evaluator.scoreMin}–${detail.evaluator.scoreMax}`} onChange={(event) => { setCorrectedScore(event.target.value); changed(); }} /></div>
                </div> : null}
                <p className="text-xs leading-relaxed text-muted-foreground">人工结论单独保存，页面平均分和通过率仍按原始 AI 结果计算。</p>
                {saveError ? <p role="alert" className="text-sm text-destructive">{saveError}</p> : null}
                <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={saving || saved || !verdict || !reason.trim()}>{saving ? "正在保存…" : saved ? <><Check aria-hidden="true" />已保存</> : "保存复核"}</Button><Button type="button" variant="outline" disabled={saving} onClick={onClose}>关闭</Button></div>
              </form>
              {latest ? <section className="space-y-2 border-t pt-4" aria-label="复核历史">
                <h2 className="text-sm font-semibold">复核历史 · {detail.reviews.length} 次</h2>
                {detail.reviews.map((record) => <div key={record.id} className="space-y-1 border-b pb-3 last:border-0">
                  <p className="text-sm font-medium">{REVIEW_LABELS[record.verdict]} <span className="font-normal text-muted-foreground">· 第 {record.revision} 次</span></p>
                  <p className="whitespace-pre-wrap break-words text-sm">{record.reason}</p>
                  {record.correctedScore !== null || record.correctedPassed !== null ? <p className="text-xs">人工修正：{record.correctedScore !== null ? `${record.correctedScore} 分` : "分数未修正"} · {record.correctedPassed !== null ? passLabel(record.correctedPassed) : "通过结论未修正"}</p> : null}
                  <p className="text-xs text-muted-foreground">{record.reviewer.username} · {new Date(record.createdAt).toLocaleString("zh-CN")}</p>
                </div>)}
              </section> : <p className="text-xs text-muted-foreground">这条结果尚未人工复核。</p>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
