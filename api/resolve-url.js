// api/resolve-url.js
// Função serverless que resolve URLs do Google News usando batchexecute (método atualizado)
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        const { urls } = req.body;
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: "URLs inválidas" });
        }

        async function decodificarUrl(url) {
            try {
                // Se não é do Google News, retorna como está
                if (!url.includes('news.google.com')) {
                    return { original: url, resolvido: url };
                }

                // Extrai o ID base64 do artigo
                const match = url.match(/articles\/([^/?]+)/);
                if (!match) return { original: url, resolvido: url };
                const base64Id = match[1];

                // Payload para o endpoint interno do Google
                const payload = `[[["Fbv4je",["garturlreq",[["en-US","US",["FINANCE_TOP_INDICES","WEB_TEST_1_0_0"],null,null,1,1,"US:en",null,180,null,null,null,null,null,0,null,null,[1608992183,723341000]],"en-US","US",1,[2,3,4,8],1,0,"655000234",0,0,null,0],"${base64Id}"]',null,"generic"]]]`;

                const response = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
                        "Referrer": "https://news.google.com/"
                    },
                    body: "f.req=" + encodeURIComponent(payload)
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const text = await response.text();
                
                // Extrai a URL original da resposta do Google
                const gartIndex = text.indexOf('garturlres');
                if (gartIndex !== -1) {
                    const substring = text.substring(gartIndex);
                    const urlMatch = substring.match(/https?:\/\/[^"\\]+/);
                    if (urlMatch) {
                        return { original: url, resolvido: urlMatch[0] };
                    }
                }
                
                return { original: url, resolvido: url };
            } catch (err) {
                console.error(`Erro ao decodificar ${url}:`, err.message);
                return { original: url, resolvido: url };
            }
        }

        const resultados = await Promise.all(urls.map(decodificarUrl));
        return res.status(200).json({ resultados });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
