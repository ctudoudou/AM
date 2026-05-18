import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const chromePath =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev";
const baseUrl = process.env.KURA_SCREENSHOT_BASE_URL || "http://localhost:3000";
const outDir = path.resolve("docs/images");

const pages = [
  {
    path: "/zh-Hans/anime",
    file: "kura-anime-library.png",
    waitFor: "24 部作品",
  },
  {
    path: "/zh-Hans/subscriptions",
    file: "kura-subscriptions.png",
    waitFor: "订阅",
  },
  {
    path: "/zh-Hans/organizer",
    file: "kura-organizer.png",
    waitFor: "整理",
  },
  {
    path: "/zh-Hans/downloads",
    file: "kura-downloads.png",
    waitFor: "下载",
  },
];

let nextId = 1;

function send(ws, method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) {
        return;
      }
      ws.removeEventListener("message", onMessage);
      if (message.error) {
        reject(new Error(`${method}: ${message.error.message}`));
        return;
      }
      resolve(message.result);
    };
    ws.addEventListener("message", onMessage);
  });
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
}

function launchChrome() {
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--disable-dev-shm-usage",
    "--window-size=1440,1000",
    "--remote-debugging-port=0",
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  const wsUrlPromise = new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for Chrome DevTools endpoint.")), 10000);
    chrome.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/.*)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1].trim());
      }
    });
    chrome.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools was ready: ${code}`));
    });
  });

  return { chrome, wsUrlPromise };
}

async function waitForContent(ws, expectedText) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await send(ws, "Runtime.evaluate", {
      expression: `(() => {
        const text = document.body?.innerText || "";
        return text.includes(${JSON.stringify(expectedText)}) && !text.includes("正在加载...");
      })()`,
      returnByValue: true,
    });
    if (result.result.value) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`Timed out waiting for page content: ${expectedText}`);
}

async function waitForImages(ws) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await send(ws, "Runtime.evaluate", {
      expression: `(() => {
        const images = [...document.images].filter((image) => {
          const rect = image.getBoundingClientRect();
          return rect.width > 40 && rect.height > 40;
        });
        if (images.length === 0) return true;
        return images.some((image) => image.complete && image.naturalWidth > 40 && image.naturalHeight > 40);
      })()`,
      returnByValue: true,
    });
    if (result.result.value) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function capturePage(page) {
  const { chrome, wsUrlPromise } = launchChrome();
  try {
    const browserWsUrl = await wsUrlPromise;
    const port = new URL(browserWsUrl).port;
    const targetsResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await targetsResponse.json();
    const target = targets.find((item) => item.type === "page");
    if (!target?.webSocketDebuggerUrl) {
      throw new Error("No Chrome page target was available for screenshot capture.");
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await waitForOpen(ws);

    await send(ws, "Page.enable");
    await send(ws, "Runtime.enable");
    await send(ws, "Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send(ws, "Page.navigate", { url: `${baseUrl}${page.path}` });
    await waitForContent(ws, page.waitFor);
    await waitForImages(ws);
    await new Promise((resolve) => setTimeout(resolve, 800));

    const screenshot = await send(ws, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    await writeFile(path.join(outDir, page.file), Buffer.from(screenshot.data, "base64"));
    ws.close();
  } finally {
    chrome.kill("SIGTERM");
  }
}

await mkdir(outDir, { recursive: true });

for (const page of pages) {
  await capturePage(page);
  console.log(`captured ${page.file}`);
}
