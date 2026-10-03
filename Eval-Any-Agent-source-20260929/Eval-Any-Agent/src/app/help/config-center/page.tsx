import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function ConfigCenterHelpPage() {
  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <div>
          <Button asChild variant="outline">
            <Link href="/dashboard">← 返回控制台</Link>
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>配置中心帮助文档</CardTitle>
            <CardDescription>说明如何在配置中心完成请求配置、动态变量与结束规则设置</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Accordion type="multiple">
              <AccordionItem value="basic">
                <AccordionTrigger>1. 基础配置流程</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm leading-6">
                  <p>1) 先上传数据集（CSV/XLSX），确保字段名正确。</p>
                  <p>2) 在配置中心选择数据集，填写配置名称与上游 API 地址。</p>
                  <p>3) 设置请求体模板 <code>requestTemplate</code>，用 <code>{"{{占位符}}"}</code> 引用变量。</p>
                  <p>4) 设置 <code>input_bindings</code>，把“占位符”映射到数据集列。</p>
                  <p><code>{"{{msg}}"}</code> 的意思是：把占位符 <code>msg</code> 的值填进这里。</p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="header">
                <AccordionTrigger>2. 自定义 Header 配置</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm leading-6">
                  <p>Header 使用 JSON 格式，例如：</p>
                  <pre className="rounded border bg-muted p-3 text-xs">
                    {`{
  "Content-Type": "application/json",
  "Authorization": "Bearer {{token}}",
  "X-Trace-Id": "{{$string.uuid}}"
}`}
                  </pre>
                  <p><code>{"{{token}}"}</code> 表示读取输入绑定里的 <code>token</code>。</p>
                  <p><code>{"{{$string.uuid}}"}</code> 表示生成动态值。带 <code>$</code> 的是系统内置变量。</p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="dynamic">
                <AccordionTrigger>3. 动态值配置（每条请求重新生成）</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm leading-6">
                  <p>动态变量可以写在请求体模板和 Header 里。</p>
                  <p><code>$</code> 开头表示系统变量。</p>
                  <p>- <code>{"{{$string.uuid}}"}</code>：生成 UUID</p>
                  <p>- <code>{"{{$date.now}}"}</code>：生成当前时间</p>
                  <p>示例：</p>
                  <pre className="rounded border bg-muted p-3 text-xs">
                    {`{
  "requestId": "{{$string.uuid}}",
  "requestTime": "{{$date.now}}",
  "msg": "{{msg}}"
}`}
                  </pre>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="extract">
                <AccordionTrigger>4. 提取规则 extract_rules</AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm leading-6">
                  <p>提取规则用于由用户指定 API 返回里哪些内容要保存成输出字段。</p>
                  <p>每条规则常用三个字段：</p>
                  <p>- <code>key</code>：结果列名</p>
                  <p>- <code>path</code>：取值路径</p>
                  <p>- <code>mode</code>：<code>text</code> 会把多段流式内容拼接为字符串，<code>json</code> 会保留 JSON 值</p>
                  <p><code>path</code> 使用 JSONPath。这里的 <code>$</code> 表示“整个返回 JSON 的根节点”。</p>
                  <p>例如 <code>$.data.answer</code> 表示取 <code>data</code> 里的 <code>answer</code>；OpenAI 兼容流式接口常见路径是 <code>$.choices[0].delta.content</code>。</p>
                  <p>示例：</p>
                  <pre className="rounded border bg-muted p-3 text-xs">
                    {`[
  { "key": "answer", "path": "$.data.answer", "mode": "text" },
  { "key": "traceId", "path": "$.meta.traceId", "mode": "json" }
]`}
                  </pre>
                  <p>这表示：</p>
                  <p>- 把 <code>$.data.answer</code> 拼接保存到输出字段 <code>answer</code></p>
                  <p>- 把 <code>$.meta.traceId</code> 按 JSON 值保存到输出字段 <code>traceId</code></p>
                  <p>如果是纯文本或无法解析成 JSON 的返回，可以这样写：</p>
                  <pre className="rounded border bg-muted p-3 text-xs">
                    {`[
  { "key": "answer", "path": "$.text", "mode": "text" }
]`}
                  </pre>
                  <p>推荐做法：</p>
                  <p>1) 先 Dry Run，看真实返回。</p>
                  <p>2) 先写 1 条最确定的路径，比如 <code>$.data.answer</code>。</p>
                  <p>3) 成功后再补其他字段。</p>
                  <p>如果提取不到值，优先检查：</p>
                  <p>- 路径是否写错</p>
                  <p>- 字段层级是否正确</p>
                  <p>- 字段名大小写是否一致</p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="done">
                <AccordionTrigger>5. 结束信号 done_rules 与 done_required</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm leading-6">
                  <p>结束信号用于判断“这次返回什么时候算结束”。</p>
                  <p>常用规则：</p>
                  <p>- <code>sentinel_text</code>：返回文本里出现固定内容，例如 <code>[DONE]</code></p>
                  <p>- <code>json_path_equals</code>：某个 JSON 字段等于指定值，例如 <code>$.type == 2</code></p>
                  <p>- <code>max_idle_ms</code>：长时间没有新内容就结束</p>
                  <p><code>$.type == 2</code> 的意思是：</p>
                  <p>- <code>$</code>：返回 JSON 根节点</p>
                  <p>- <code>$.type</code>：根节点下的 <code>type</code> 字段</p>
                  <p>- <code>== 2</code>：当它的值等于 2 时，判定结束</p>
                  <p><code>done_required</code> 开启后，如果没有命中任何结束规则，会标记为 <code>END_SIGNAL_MISSING</code>。</p>
                  <p>推荐做法：先 Dry Run，再看 <code>endReason</code> 和 <code>ruleHit</code> 是否符合预期。</p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
