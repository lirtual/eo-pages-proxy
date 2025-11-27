interface Env {
  TARGET_HOSTNAME?: string;
  BASE64_HEADERS?: string; // Base64编码的JSON字符串格式
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
  const targetHostname = env?.TARGET_HOSTNAME || "cdn.jsdelivr.net";
  url.hostname = targetHostname;

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
      console.error("Failed to decode/parse CUSTOM_HEADERS:", e);
    }
  }
  
  // 请求体处理，仅在允许的情况下传递 body
  const method = request.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);

  // 生成回源请求
  const req = new Request(url.toString(), {
    method,
    headers,
    body: hasBody ? request.body : undefined,
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
