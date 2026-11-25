const MESSAGES = {
  zh: {
    providerName: "Aside",

    loginBrowser: "读取本机 Aside 登录账号",
    loginPaste: "粘贴 Aside 访问令牌",
    loginGoogle: "使用 Google 登录 Aside",

    promptDataDir: "Aside 数据目录（留空自动探测）",
    promptBrowserKey: "输入 auto 读取本机账号，或直接粘贴访问令牌",
    promptAccessToken: "Aside 访问令牌（JWT）",
    promptEmail: "账号邮箱（可选，显示用）",

    errKeyMissing: "缺少 Aside 访问令牌。",
    errNoCredentials:
      "没有找到 Aside 登录信息。已尝试：{tried}。请先在 Aside 浏览器里登录一次。",
    errBadCredentials: "账号文件解析失败：{path}（{reason}）",
    errSignInExpired: "Aside 登录已失效，请重新登录。",
    errForbidden: "Aside 拒绝了这次请求（403）。",
    errEndpoint: "该模型需要不同的 API 端点（426）。请更新插件。",
    errRateLimited: "Aside 限流了这次请求（429），稍后重试。",
    errUpstream: "Aside 上游返回 {status}。",
    errTimeout: "请求超时，请重试。",
    errRedirect: "请求被重定向到登录页（鉴权失败），请重新登录。",
    errNoToken: "没有可用的 Aside 访问令牌。",
    errCloudflare: "Cloudflare 拦截了请求（1010）。宿主可能覆盖了 User-Agent。",

    usageSessionName: "Aside 会话",
    usageSessionLeft: "访问令牌剩余 {time}",
    usageSessionExpired: "访问令牌已过期",
    usageNoSession: "未读取到账号会话",
    usageCreditName: "本月额度",
    usageCreditDisplay: "剩 {balance} / {grant}",
    usageAddOnName: "附加额度",

    googleInstructions:
      "在刚打开的 Aside 窗口里用 Google 登录。登录完成后这里会自动继续；若 Aside 没有打开，从新打开的页面下载安装后再登录。",
    errGoogleNoApp:
      "没有找到 Aside 应用。请先从 aside.com/download 安装，并在应用里用 Google 登录。",
    errGoogleTimeout: "等待 Aside 登录超时，请重试。",
  },
  en: {
    providerName: "Aside",

    loginBrowser: "Read the signed-in Aside account",
    loginPaste: "Paste an Aside access token",
    loginGoogle: "Sign in with Google",

    promptDataDir: "Aside data dir (empty = auto-detect)",
    promptBrowserKey:
      "Type auto to read the local account, or paste an access token",
    promptAccessToken: "Aside access token (JWT)",
    promptEmail: "Account email (optional, display only)",

    errKeyMissing: "The Aside access token is missing.",
    errNoCredentials:
      "No Aside sign-in found. Tried: {tried}. Sign in to the Aside browser once.",
    errBadCredentials: "Cannot parse the account file: {path} ({reason})",
    errSignInExpired: "The Aside sign-in expired. Please sign in again.",
    errForbidden: "Aside refused the request (403).",
    errEndpoint:
      "This model needs a different API endpoint (426). Update the plugin.",
    errRateLimited: "Aside rate-limited the request (429). Retry shortly.",
    errUpstream: "Aside upstream answered {status}.",
    errTimeout: "Timed out. Please retry.",
    errRedirect:
      "The request was redirected to the sign-in page (auth failed). Sign in again.",
    errNoToken: "No Aside access token is available.",
    errCloudflare:
      "Cloudflare blocked the request (1010). The host may be overriding the User-Agent.",

    usageSessionName: "Aside session",
    usageSessionLeft: "Access token valid for {time}",
    usageSessionExpired: "Access token expired",
    usageNoSession: "No account session was read",
    usageCreditName: "Monthly credit",
    usageCreditDisplay: "{balance} / {grant} left",
    usageAddOnName: "Add-on credit",

    googleInstructions:
      "Finish the Google sign-in in the Aside window that just opened. This dialog continues automatically. If Aside did not open, install it from the page that just opened, then sign in.",
    errGoogleNoApp:
      "The Aside app was not found. Install it from aside.com/download and sign in with Google there.",
    errGoogleTimeout: "Timed out waiting for the Aside sign-in. Please retry.",
  },
};

function systemLocale() {
  if (typeof process !== "undefined") {
    for (const name of ["MAGPIE_LANG", "LC_ALL", "LC_MESSAGES", "LANG"]) {
      const value = String(process.env?.[name] ?? "").trim();
      if (value && !/^(c|posix)(\.|$)/i.test(value)) return value;
    }
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? "";
  } catch {
    return "";
  }
}

export function detectLang({ locale = systemLocale() } = {}) {
  const value = String(locale ?? "")
    .trim()
    .toLowerCase();
  return value.startsWith("zh") ? "zh" : "en";
}

export function resolveLang(options = {}) {
  const raw = String(options.lang ?? "auto")
    .trim()
    .toLowerCase();
  if (raw.startsWith("zh")) return "zh";
  if (raw.startsWith("en")) return "en";
  return detectLang();
}

export function t(lang, key, vars = {}) {
  const dict = MESSAGES[lang] ?? MESSAGES.zh;
  const raw = dict[key] ?? MESSAGES.zh[key] ?? key;
  return String(raw).replace(
    /\{(\w+)\}/g,
    (_, name) => vars[name] ?? `{${name}}`,
  );
}

export const MESSAGES_ALL = MESSAGES;
