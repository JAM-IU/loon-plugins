/*
 Loon AI 节点检测器（全球节点版）
 用法：在 Loon 的“脚本/Generic”中运行，也可用 cron 定时运行。
 默认扫描“全球手动策略”，会包含英国、荷兰、加拿大等非热门节点。
 若脚本参数填写其他策略组名称，则扫描该策略组。

 检测结果保存到 persistentStore，并通过 iOS 通知显示。
 检测到同时支持 Gemini 和 ChatGPT 的节点后，自动切换“AI智能策略”。
*/

const requestedPolicy = (typeof $argument !== "undefined" && $argument && $argument.trim()) || "";
// 兼容旧配置：如果旧配置传入“AI智能策略”，改为扫描全球候选节点。
const SOURCE_POLICY = (!requestedPolicy || requestedPolicy === "AI智能策略") ? "全球手动策略" : requestedPolicy;
const AI_POLICY = "AI智能策略";
const STORE_KEY = "loon_ai_node_test_v2";
const TIMEOUT = 8000;
const CONCURRENCY = 5;
const GEMINI_URL = "https://gemini.google.com/";
const CHATGPT_URL = "https://chatgpt.com/";

function notify(title, content) {
  $notification.post(title, "Loon AI 节点检测", content);
}

function getSubPolicies(policy) {
  return new Promise(resolve => {
    try { $config.getSubPolicies(policy, x => resolve(x || [])); }
    catch (_) { resolve([]); }
  });
}

async function expandPolicy(policy, seen) {
  seen = seen || {};
  if (seen[policy]) return [];
  seen[policy] = true;
  const children = await getSubPolicies(policy);
  const groups = {};
  try {
    const cfg = JSON.parse($config.getConfig());
    (cfg.all_policy_groups || []).forEach(x => { groups[x] = true; });
  } catch (_) {}
  let out = [];
  for (const child of children) {
    if (!child || child === "DIRECT" || child === "REJECT") continue;
    out = out.concat(groups[child] ? await expandPolicy(child, seen) : [child]);
  }
  return [...new Set(out)];
}

function request(url, node) {
  return new Promise(resolve => {
    $httpClient.get({
      url: url,
      node: node,
      timeout: TIMEOUT,
      "auto-redirect": true,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
      }
    }, (err, res, body) => resolve({
      ok: !err && res && res.status >= 200 && res.status < 400,
      status: res ? res.status : 0,
      body: String(body || "").slice(0, 100000),
      error: err ? String(err) : ""
    }));
  });
}

function regionBlocked(body) {
  return /not available in your country|isn't available in your country|not available in your region|unsupported country|unsupported region|openai services are not available|gemini apps? isn't available/i.test(body || "");
}

async function testNode(node) {
  const gemini = await request(GEMINI_URL, node);
  const chatgpt = await request(CHATGPT_URL, node);
  return {
    node: node,
    gemini: gemini.ok && !regionBlocked(gemini.body),
    chatgpt: chatgpt.ok && !regionBlocked(chatgpt.body),
    geminiStatus: gemini.status,
    chatgptStatus: chatgpt.status,
    geminiError: gemini.error,
    chatgptError: chatgpt.error,
    testedAt: new Date().toISOString()
  };
}

async function runPool(nodes) {
  const results = [];
  const queue = nodes.slice();
  async function worker() {
    while (queue.length) {
      const node = queue.shift();
      results.push(await testNode(node));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, nodes.length) }, worker));
  return results;
}

(async function () {
  // 立即反馈，避免用户误以为脚本没有运行。
  notify("AI 节点检测已开始", `正在扫描“${SOURCE_POLICY}”，请等待结果通知`);
  try {
    const nodes = await expandPolicy(SOURCE_POLICY, {});
    if (!nodes.length) {
      notify("没有找到节点", `策略组“${SOURCE_POLICY}”没有可检测的具体节点`);
      return $done();
    }

    const results = await runPool(nodes);
    const both = results.filter(x => x.gemini && x.chatgpt).map(x => x.node);
    const geminiOnly = results.filter(x => x.gemini && !x.chatgpt).map(x => x.node);
    const chatgptOnly = results.filter(x => !x.gemini && x.chatgpt).map(x => x.node);

    $persistentStore.write(JSON.stringify({
      sourcePolicy: SOURCE_POLICY,
      testedAt: new Date().toISOString(),
      both: both,
      geminiOnly: geminiOnly,
      chatgptOnly: chatgptOnly,
      results: results
    }), STORE_KEY);

    let selected = "";
    if (both.length) {
      try {
        if ($config.getConfig(AI_POLICY, both[0])) selected = both[0];
      } catch (_) {}
    }

    const lines = [
      `扫描 ${results.length} 个节点`,
      `Gemini+ChatGPT：${both.length} 个`,
      `仅 Gemini：${geminiOnly.length} 个`,
      `仅 ChatGPT：${chatgptOnly.length} 个`
    ];
    if (selected) lines.push(`已切换“${AI_POLICY}”：${selected}`);
    else if (both.length) lines.push(`检测到可用节点，但“${AI_POLICY}”不包含它`);
    lines.push(both.length ? `可用：${both.slice(0, 8).join("、")}${both.length > 8 ? "…" : ""}` : "没有发现同时支持两个服务的节点");
    notify("AI 节点检测完成", lines.join("\n"));
  } catch (e) {
    notify("AI 节点检测失败", String(e));
  } finally {
    $done();
  }
})();
