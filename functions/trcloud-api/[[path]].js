export async function onRequest(context) {
  const { request, params } = context;
  const url = new URL(request.url);
  
  // path จะถูกจับโดย [[path]] ในชื่อไฟล์
  // เช่น /trcloud-api/some/path -> params.path = ["some", "path"]
  const path = params.path ? params.path.join('/') : '';
  const search = url.search;
  
  const targetUrl = `https://thaidrill.trcloud.co/${path}${search}`;
  
  // คัดลอก headers จาก request เดิม
  const newHeaders = new Headers(request.headers);
  
  // ตั้งค่า headers ที่จำเป็นสำหรับ TRCloud
  newHeaders.set('Origin', 'https://thaidrill.trcloud.co');
  const pathLower = path.toLowerCase();
  let referer = 'https://thaidrill.trcloud.co/application/';
  if (pathLower.includes('invoice_list.php')) {
    referer = 'https://thaidrill.trcloud.co/application/expense_report/invoice_list.php';
  } else if (pathLower.includes('invoice_by_supplier.php')) {
    referer = 'https://thaidrill.trcloud.co/application/expense_report/invoice_by_supplier.php';
  } else if (pathLower.includes('/engine-po/') || pathLower.includes('/engine-pr/') || pathLower.includes('/engine-expense/')) {
    referer = 'https://thaidrill.trcloud.co/application/expense/';
  }
  newHeaders.set('Referer', referer);
  newHeaders.set('X-Requested-With', 'XMLHttpRequest');
  newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

  // จัดการเรื่อง Cookie
  // ถ้ามี Cookie ส่งมาจาก Client (Browser) ผ่าน header x-trcloud-cookie ให้เอามาใช้
  const clientCookie = request.headers.get('x-trcloud-cookie');
  if (clientCookie) {
    newHeaders.set('Cookie', clientCookie);
    newHeaders.delete('x-trcloud-cookie');
  }

  // สร้าง request ใหม่เพื่อส่งไปยัง TRCloud
  const modifiedRequest = new Request(targetUrl, {
    method: request.method,
    headers: newHeaders,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : null,
    redirect: 'follow'
  });

  try {
    const response = await fetch(modifiedRequest);
    
    // สร้าง response ใหม่เพื่อส่งกลับไปยัง Browser
    const newResponse = new Response(response.body, response);
    
    // ตั้งค่า CORS (ถ้าจำเป็น แม้ว่าจะเป็น origin เดียวกันบน Pages ก็ตาม)
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    
    return newResponse;
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
