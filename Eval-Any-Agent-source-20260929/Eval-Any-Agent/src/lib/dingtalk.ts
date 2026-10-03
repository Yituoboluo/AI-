import crypto from "node:crypto";

export async function notifyDingTalkMarkdown(title: string, text: string) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) return;
  const secret = process.env.DINGTALK_SECRET;
  const url = new URL(webhook);
  if (secret) {
    const timestamp = Date.now().toString();
    const stringToSign = `${timestamp}\n${secret}`;
    url.searchParams.set("timestamp", timestamp);
    url.searchParams.set("sign", crypto.createHmac("sha256", secret).update(stringToSign).digest("base64"));
  }
  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ msgtype: "markdown", markdown: { title, text } }) });
}
