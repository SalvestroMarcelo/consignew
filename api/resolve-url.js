// api/resolve-url.js
// Função serverless que resolve URLs do Google News usando o endpoint interno batchexecute
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        const { urls } = req.body;

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: "URLs inválidas" });
        }

        // Função para decodificar uma URL do Google News via batchexecute
        async function decodificarUrl(url) {
            try {
                // Se não é do Google News, retorna como está
                if (!url.includes('news.google.com')) {
                    return { original: url, resolvido: url };
                }

                // Extrai o ID base64 do caminho /articles/XXXXX
                const urlObj = new URL(url);
                const pathParts = urlObj.pathname.split('/');
                const articlesIndex = pathParts.indexOf('articles');
                
                if (articlesIndex === -1 || articlesIndex >= pathParts.length - 1) {
                    return { original: url, resolvido: url };
                }

                const base64Id = pathParts[articlesIndex + 1].split('?')[0];

                // Monta o payload para o batchexecute
                const payload = `[[["Fbv4je",["garturlreq",[["en-US","US",["FINANCE_TOP_INDICES","WEB_TEST_1_0_0"],null,null,1,1,"US:en",null,180,null,null,null,null,null,0,null,null,[1608992183,723341000]],"en-US","US",1,[2,3,4,8],1,0,"655000234",0,0,null,0],"${base64Id}"]',null,"generic"]]]`;

                // Faz a requisição POST para o endpoint interno do Google
                const response = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
                        "Referrer": "https://news.google.com/"
                    },
                    body: "f.req=" + encodeURIComponent(payload)
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const text = await response.text();
                
                // Extrai o URL da resposta
                const header = '["garturlres","';
                const footer = '",';
                
                const headerIndex = text.indexOf(header);
                if (headerIndex === -1) {
                    throw new Error("Header não encontrado na resposta");
                }

                const start = text.substring(headerIndex + header.length);
                const footerIndex = start.indexOf(footer);
                
                if (footerIndex === -1) {
                    throw new Error("Footer não encontrado na resposta");
                }

                const urlResolvido = start.substring(0, footerIndex);
                
                return { original: url, resolvido: urlResolvido };
            } catch (err) {
                console.error(`Erro ao decodificar ${url}:`, err.message);
                // Fallback: se falhar, mantém o URL do Google
                return { original: url, resolvido: url };
            }
        }

        // Processa todas as URLs em paralelo
        const resultados = await Promise.all(urls.map(decodificarUrl));

        return res.status(200).json({ resultados });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
