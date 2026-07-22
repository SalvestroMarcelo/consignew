// api/resolve-url.js
// Função serverless que resolve URLs do Google News usando múltiplos métodos
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        const { urls } = req.body;
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: "URLs inválidas" });
        }

        // MÉTODO 1: Decodificação base64 (funciona para URLs antigas do Google News)
        function decodificarBase64(url) {
            try {
                // URLs antigas: https://news.google.com/__i/rss/rd/articles/CBMi...
                const match = url.match(/\/articles\/([^/?]+)/);
                if (!match) return null;

                let encodedText = match[1];
                
                // Corrige padding do base64
                const padding = encodedText.length % 4;
                if (padding > 0) {
                    encodedText += '='.repeat(4 - padding);
                }

                // Decodifica base64
                const decoded = Buffer.from(encodedText, 'base64');
                
                // Extrai a URL do texto decodificado
                // Formato: bytes iniciais + URL + bytes finais
                const decodedString = decoded.toString('utf-8', 'backslashreplace');
                
                // Procura por http:// ou https://
                const httpMatch = decodedString.match(/https?:\/\/[^\\]+/);
                if (httpMatch) {
                    return httpMatch[0].replace(/\\x[0-9a-fA-F]{2}/g, '');
                }

                return null;
            } catch (err) {
                console.error(`Erro ao decodificar base64 de ${url}:`, err.message);
                return null;
            }
        }

        // MÉTODO 2: Extração via HTML (fallback para URLs novas)
        async function extrairDoHTML(url) {
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });

                if (!response.ok) return null;

                const html = await response.text();
                
                // Procura por window.location ou meta refresh
                const locationMatch = html.match(/window\.location\s*=\s*["']([^"']+)["']/);
                if (locationMatch) {
                    return locationMatch[1];
                }

                const metaMatch = html.match(/<meta[^>]*content=["'][^"']*url=([^"']+)["']/i);
                if (metaMatch) {
                    return metaMatch[1];
                }

                // Procura por qualquer URL http/https no HTML
                const urlMatch = html.match(/https?:\/\/[^"'\s<>]+/g);
                if (urlMatch && urlMatch.length > 0) {
                    // Filtra URLs do Google
                    const urlOriginal = urlMatch.find(u => !u.includes('google.com') && !u.includes('gstatic.com'));
                    if (urlOriginal) {
                        return urlOriginal;
                    }
                }

                return null;
            } catch (err) {
                console.error(`Erro ao extrair do HTML de ${url}:`, err.message);
                return null;
            }
        }

        // Processa todas as URLs
        const resultados = await Promise.all(urls.map(async (url) => {
            try {
                // Se não é do Google News, retorna como está
                if (!url.includes('news.google.com')) {
                    return { original: url, resolvido: url };
                }

                // Tenta método 1: decodificação base64
                let urlResolvida = decodificarBase64(url);
                
                // Se falhou, tenta método 2: extração do HTML
                if (!urlResolvida) {
                    urlResolvida = await extrairDoHTML(url);
                }

                // Se ainda não conseguiu, mantém o URL do Google
                if (!urlResolvida) {
                    console.warn(`Não foi possível resolver: ${url}`);
                    return { original: url, resolvido: url };
                }

                return { original: url, resolvido: urlResolvida };
            } catch (err) {
                console.error(`Erro ao processar ${url}:`, err.message);
                return { original: url, resolvido: url };
            }
        }));

        return res.status(200).json({ resultados });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
