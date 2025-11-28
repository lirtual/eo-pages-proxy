interface Env {
  TARGET_HOSTNAME?: string;
  BASE64_HEADERS?: string; // Base64编码的JSON字符串格式
  MODEL?: string; // 默认语言模型
  SYSTEM_PROMPT?: string; // 默认系统提示词
  TARGET_PATH?: string; // 目标路径，如果设置则强制使用该路径，未设置则保持原始路径
}

interface GeoProperties {
  asn: number;
  countryName: string;
  countryCodeAlpha2: string;
  countryCodeAlpha3: string;
  countryCodeNumeric: string;
  regionName: string;
  regionCode: string;
  cityName: string;
  latitude: number;
  longitude: number;
  cisp: string;
}

interface IncomingRequestEoProperties {
  geo: GeoProperties;
  uuid: string;
  clientIp: string;
}

interface EORequest extends Request {
  readonly eo: IncomingRequestEoProperties;
}

// 处理 OPTIONS 预检请求
export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

// 处理所有请求
export async function onRequest({ request, env }: { request: EORequest; env?: Env }) {
  // 处理 URL
  const url = new URL(request.url);
  // 从环境变量获取反代目标域名，如果未设置则使用默认值
  const targetHostname = env?.TARGET_HOSTNAME || "api.openai.com";
  url.hostname = targetHostname;
  
  // 如果设置了 TARGET_PATH 环境变量，则强制使用该路径；否则保持客户端的原始路径
  if (env?.TARGET_PATH) {
    url.pathname = env.TARGET_PATH;
  }

  // 请求头处理,去除可能导致错误的 headers
  const headers = new Headers(request.headers);
  // 如果不知道有什么,可以取消注释以下内容:
  // return new Response(JSON.stringify(headers));
  headers.delete("host");
  headers.delete("Accept-Encoding");
    
  // 添加自定义请求头(从环境变量中读取Base64编码的JSON)
  if (env?.BASE64_HEADERS) {
    try {
      // Base64解码
      const decodedJson = atob(env.BASE64_HEADERS);
      // 解析JSON
      const customHeaders = JSON.parse(decodedJson);
      // 设置自定义请求头
      Object.entries(customHeaders).forEach(([key, value]) => {
        headers.set(key, String(value));
      });
    } catch (e) {
      console.error("Failed to decode/parse BASE64_HEADERS:", e);
    }
  }
  
  // 请求体处理，仅在允许的情况下传递 body
  const method = request.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);

  // 处理请求体：如果是简化格式 {content:""}, 转换为 ChatGPT API 格式
  let requestBody: BodyInit | null | undefined = hasBody ? request.body : undefined;
  
  if (hasBody && request.headers.get("content-type")?.includes("application/json")) {
    try {
      const bodyText = await request.text();
      const clientBody = JSON.parse(bodyText);
      
      // 检测是否为简化格式 {content:""}
      if (clientBody.content !== undefined && !clientBody.model) {
        // 从环境变量获取默认模型和系统提示词
        const defaultModel = env?.MODEL || "gpt-3.5-turbo";
        const systemPrompt = env?.SYSTEM_PROMPT || "You are a helpful assistant.";
        
        // 构建符合 ChatGPT API 规范的完整请求体
        const chatGPTBody = {
          model: defaultModel,
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: clientBody.content
            }
          ],
          temperature: 0.7,
          // max_tokens: 2000,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0
        };
        
        // 将转换后的请求体转为字符串
        requestBody = JSON.stringify(chatGPTBody);
        headers.set("content-type", "application/json");
      } else {
        // 如果已经是完整格式，直接使用原始请求体
        requestBody = bodyText;
      }
    } catch (e) {
      console.error("Failed to parse request body:", e);
      // 解析失败时使用原始请求体
      requestBody = request.body;
    }
  }

  // 生成回源请求
  const req = new Request(url.toString(), {
    method,
    headers,
    body: requestBody,
    redirect: "follow",
  });

  try {
    // 发起请求，返回只读属性的响应
    const response = await fetch(req);

    // 拷贝响应，方便后续修改
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });

    // 处理响应头
    newResponse.headers.set("Access-Control-Allow-Origin", "*");

    // 返回响应
    return newResponse;
  } catch (e: any) {
    // 返回错误
    return new Response(
      JSON.stringify({ error: e?.message || String(e), url: url.toString() }),
      {
        status: 502,
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
