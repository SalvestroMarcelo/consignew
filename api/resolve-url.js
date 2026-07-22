// api/resolve-url.js
// Função serverless que resolve URLs do Google News para os URLs originais
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        const { urls } = req.body;

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: "URLs inválidas" });
        }

        // Processa todas as URLs em paralelo
        const resultados = await Promise.all(urls.map(async (url) => {
            try {
                // Se já não é do Google News, retorna como está
                if (!url.includes('news.google.com')) {
                    return { original: url, resolvido: url };
                }

                // Faz GET seguindo redirects automaticamente
                const response = await fetch(url, {
                    method: 'GET',
                    redirect: 'follow', // segue 301, 302, etc automaticamente
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });

                // response.url contém o URL final após todos os redirects
                return { 
                    original: url, 
                    resolvido: response.url 
                };
            } catch (err) {
                console.error(`Erro ao resolver ${url}:`, err.message);
                // Fallback: se falhar, mantém o URL do Google
                return { original: url, resolvido: url };
            }
        }));

        return res.status(200).json({ resultados });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
