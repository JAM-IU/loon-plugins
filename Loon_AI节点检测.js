/*
 Loon AI 节点检测器
 用法：在 Loon 的“脚本/Generic”中运行，默认检测“全球手动策略”的全部子节点。
 可在脚本参数中填写策略组名称，例如：全球手动策略

 检测结果会保存到 persistentStore，并通过通知显示。
 如果存在名为“AI智能策略”的 select 策略组，脚本会自动选中第一个同时通过 Gemini 和 ChatGPT 的节点。
*/

const SOURCE_POLICY = (typeof $argument !== "undefined" && $argument && $argument.trim()) || "AI智能策略";
const AI_POLICY = "AI智能策略";
const STORE_KEY = "loon_ai_node_test_v1";
const TIMEOUT = 12000;
const GAP = 250;

const GEMINI_URL = "https://gemini.google.com/";
const CHATGPT_URL = "https://chatgpt.com/";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function get(url, node) {
  return new Promise(resolve => {
    $httpClient.get({
      url,
      node,
      timeout: TIMEOUT,
      "auto-redirect": true,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
      }
    }, (error, response, body) => {
      resolve({
        ok: !error && response && response.status >= 200 && response.status < 400,
        status: response ? response.status : 0,
        body: (body || "").toString().slice(0, 120000),
        error: error ? String(error) : ""
      });
    });
  });
}

function hasRegionBlock(body, service) {
  const s = (body || "").toLowerCase();
  if (service === "gemini") {
    return /not available in your country|isn't available in your country|not available in your region|currently unavailable in your country|gemini apps? isn't available/i.test(s);
  }
  return /openai services are not available|not available in your country|unsupported country|unsupported region|not available in your region/i.test(s);
}

async function testNode(node) {
  const gemini = await get(GEMINI_URL, node);
  await sleep(GAP);
  const chatgpt = await get(CHATGPT_URL, node);
  const geminiOK = gemini.ok && !hasRegionBlock(gemini.body, "gemini");
  const chatgptOK = chatgpt.ok && !hasRegionBlock(chatgpt.body, "chatgpt");
  return {
    node,
    gemini: geminiOK,
    chatgpt: chatgptOK,
    geminiStatus: gemini.status,
    chatgptStatus: chatgpt.status,
    geminiError: gemini.error,
    chatgptError: chatgpt.error,
    time: new Date().toISOString()
  };
}

function notify(title, content) {
  $notification.post(title, "Loon AI 节点检测", content);
}

function getSubPolicies(policy) {
  return new Promise(resolve => {
    try {
      $config.getSubPolicies(policy, children => resolve(children || []));
    } catch (_) {
      resolve([]);
    }
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
  const out = [];
  for (const child of children) {
    if (!child || child === "DIRECT" || child === "REJECT") continue;
    if (groups[child]) out.push(...await expandPolicy(child, seen));
    else out.push(child);
  }
  return [...new Set(out)];
}

(async function () {
  try {
    const nodes = await expandPolicy(SOURCE_POLICY, {});
    if (!nodes.length) {
      notify("没有找到节点", `策略组“${SOURCE_POLICY}”没有可检测的子节点`);
      return $done();
    }

    const results = [];
    for (const node of nodes) {
      results.push(await testNode(node));
    }

    const both = results.filter(x => x.gemini && x.chatgpt).map(x => x.node);
    const geminiOnly = results.filter(x => x.gemini && !x.chatgpt).map(x => x.node);
    const chatgptOnly = results.filter(x => !x.gemini && x.chatgpt).map(x => x.node);

    $persistentStore.write(JSON.stringify({
      sourcePolicy: SOURCE_POLICY,
      testedAt: new Date().toISOString(),
      both,
      geminiOnly,
      chatgptOnly,
      results
    }), STORE_KEY);

    let selected = "";
    if (both.length) {
      try {
        if ($config.getConfig(AI_POLICY, both[0])) selected = both[0];
      } catch (_) {}
    }

    const lines = [
      `检测 ${results.length} 个节点`,
      `Gemini+ChatGPT：${both.length} 个`,
      `仅 Gemini：${geminiOnly.length} 个`,
      `仅 ChatGPT：${chatgptOnly.length} 个`
    ];
    if (selected) lines.push(`已将“${AI_POLICY}”切换到：${selected}`);
    if (both.length) lines.push(`可用节点：${both.slice(0, 8).join("、")}${both.length > 8 ? "…" : ""}`);
    else lines.push("没有发现同时支持两个服务的节点，请更换订阅或节点");
    notify("AI 节点检测完成", lines.join("\n"));
  } catch (e) {
    notify("AI 节点检测失败", String(e));
  } finally {
    $done();
  }
});


