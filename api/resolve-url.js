// api/resolve-url.js
// Função serverless que resolve URLs do Google News usando batchexecute (método atualizado 2024/2025)
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

                // PASSO 1: Faz GET na URL do Google News para extrair dados do HTML
                const getResponse = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });

                if (!getResponse.ok) {
                    throw new Error(`GET HTTP ${getResponse.status}`);
                }

                const html = await getResponse.text();
                
                // Extrai o atributo data-p do elemento c-wiz usando regex
                const dataPMatch = html.match(/data-p="([^"]+)"/);
                if (!dataPMatch) {
                    throw new Error("Atributo data-p não encontrado no HTML");
                }

                // Decodifica e processa o data-p
                const dataP = dataPMatch[1]
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>');
                
                let parsedData = JSON.parse(dataP.replace('%.@.', '["garturlreq",'));
                
                // PASSO 2: Monta o payload para o batchexecute
                const payload = {
                    'f.req': JSON.stringify([[
                        ['Fbv4je', JSON.stringify([...parsedData.slice(0, -6), ...parsedData.slice(-2)]), 'null', 'generic']
                    ]])
                };

                // Faz POST no endpoint interno do Google
                const postResponse = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    },
                    body: new URLSearchParams(payload).toString()
                });

                if (!postResponse.ok) {
                    throw new Error(`POST HTTP ${postResponse.status}`);
                }

                const responseText = await postResponse.text();
                
                // Remove o prefixo )]}' que o Google adiciona
                const cleanText = responseText.replace(/^\)\]\}'/, '');
                const responseData = JSON.parse(cleanText);
                
                // Extrai a URL original da resposta
                const arrayString = responseData[0][2];
                if (!arrayString) {
                    throw new Error("Resposta não contém arrayString");
                }
                
                const urlData = JSON.parse(arrayString);
                const urlResolvido = urlData[1];
                
                if (!urlResolvido) {
                    throw new Error("URL resolvida não encontrada na resposta");
                }

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
