/* Loon AI 节点检测器（筛选策略兼容版）
 * 适用于使用 NameRegex 筛选节点的配置。
 * 脚本直接测试筛选策略本身，不尝试展开筛选器中的具体节点。
 * 参数可填写逗号分隔的策略名，例如：美国节点,日本节点,新国节点,英国节点
 */
const arg = (typeof $argument !== "undefined" && $argument && $argument.trim()) || "";
const POLICIES = (arg ? arg.split(/[,，\n]/) : ["美国节点", "日本节点", "新国节点", "英国节点", "全球节点"])
  .map(x => x.trim()).filter((x, i, a) => x && a.indexOf(x) === i);
const AI_POLICY = "AI智能策略";
const TIMEOUT = 10000;
const GEMINI_URL = "https://gemini.google.com/";
const CHATGPT_URL = "https://chatgpt.com/";

function notify(title, content) { $notification.post(title, "Loon AI 节点检测", content); }
function request(url, policy) {
  return new Promise(resolve => {
    $httpClient.get({
      url: url,
      node: policy,
      timeout: TIMEOUT,
      "auto-redirect": true,
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" }
    }, (err, res, body) => resolve({
      ok: !err && res && res.status >= 200 && res.status < 400,
      status: res ? res.status : 0,
      body: String(body || "").slice(0, 100000),
      error: err ? String(err) : ""
    }));
  });
}
function blocked(body) {
  return /not available in your country|isn't available in your country|not available in your region|unsupported country|unsupported region|openai services are not available|gemini apps? isn't available/i.test(body || "");
}
async function testPolicy(policy) {
  const g = await request(GEMINI_URL, policy);
  const c = await request(CHATGPT_URL, policy);
  return { policy, gemini: g.ok && !blocked(g.body), chatgpt: c.ok && !blocked(c.body), geminiStatus: g.status, chatgptStatus: c.status, geminiError: g.error, chatgptError: c.error };
}
(async function () {
  notify("AI 节点检测已开始", `正在测试 ${POLICIES.length} 个筛选策略：${POLICIES.join("、")}`);
  try {
    const results = [];
    for (const policy of POLICIES) results.push(await testPolicy(policy));
    const both = results.filter(x => x.gemini && x.chatgpt).map(x => x.policy);
    let selected = "";
    if (both.length) {
      try { if ($config.getConfig(AI_POLICY, both[0])) selected = both[0]; } catch (_) {}
    }
    $persistentStore.write(JSON.stringify({ testedAt: new Date().toISOString(), results, both }), "loon_ai_policy_test_v1");
    const lines = [
      `测试 ${results.length} 个筛选策略`,
      `Gemini+ChatGPT：${both.length} 个`,
      `可用策略：${both.length ? both.join("、") : "无"}`
    ];
    if (selected) lines.push(`已将“${AI_POLICY}”切换到：${selected}`);
    else if (both.length) lines.push(`检测通过，但“${AI_POLICY}”未包含这些策略`);
    notify("AI 节点检测完成", lines.join("\n"));
  } catch (e) { notify("AI 节点检测失败", String(e)); }
  finally { $done(); }
})();
