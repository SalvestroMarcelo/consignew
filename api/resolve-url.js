// api/resolve-url.js
// Função serverless que resolve URLs do Google News para a URL real da notícia.
//
// IMPORTANTE (leia o comentário no final do arquivo):
// O Google não expõe um endpoint público e estável para isso. O método abaixo
// reproduz o mesmo processo em 2 etapas que o próprio site news.google.com faz
// no navegador do usuário:
//   1) Carrega a página do artigo (news.google.com/articles/{id}) e extrai um
//      "carimbo" de assinatura/timestamp (data-n-a-sg / data-n-a-ts) que o Google
//      gera para aquele artigo especificamente.
//   2) Usa esse carimbo para chamar o endpoint interno "batchexecute" e obter a
//      URL de origem.
// A versão anterior pulava a etapa 1 e usava um payload fixo, por isso o Google
// rejeitava a requisição (silenciosamente) e o código caía no "fallback" que
// devolve a própria URL do Google — por isso o link e a fonte não mudavam.

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        const { urls } = req.body;
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: "URLs inválidas" });
        }

        const HEADERS_NAVEGADOR = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        };

        function extrairArticleId(url) {
            const match = url.match(/articles\/([^/?]+)/);
            return match ? match[1] : null;
        }

        // Etapa 1: pega a página do artigo e extrai o par (assinatura, timestamp)
        // que o Google associa a esse ID especificamente.
        async function obterParametrosDeDecodificacao(articleId) {
            const candidatos = [
                `https://news.google.com/articles/${articleId}`,
                `https://news.google.com/rss/articles/${articleId}`
            ];

            for (const paginaUrl of candidatos) {
                try {
                    const resposta = await fetch(paginaUrl, { headers: HEADERS_NAVEGADOR });
                    if (!resposta.ok) continue;
                    const html = await resposta.text();

                    const sigMatch = html.match(/data-n-a-sg="([^"]+)"/);
                    const tsMatch = html.match(/data-n-a-ts="([^"]+)"/);

                    if (sigMatch && tsMatch) {
                        return { signature: sigMatch[1], timestamp: tsMatch[1] };
                    }
                } catch (e) {
                    // tenta o próximo candidato
                }
            }
            return null;
        }

        // Etapa 2: chama o batchexecute já com a assinatura/timestamp corretos.
        async function chamarBatchExecute(articleId, timestamp, signature) {
            const payloadInterno = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${articleId}",${timestamp},"${signature}"]`;

            const payloadFinal = JSON.stringify([[["Fbv4je", payloadInterno]]]);

            const resposta = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
                method: "POST",
                headers: {
                    ...HEADERS_NAVEGADOR,
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
                },
                body: "f.req=" + encodeURIComponent(payloadFinal)
            });

            if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
            const texto = await resposta.text();

            // A resposta vem com um prefixo anti-XSSI (")]}'") seguido de várias
            // linhas de tamanho + JSON. Em vez de fazer parsing estrito (frágil a
            // mudanças de formato), procuramos a URL que vem logo após "garturlres".
            const indiceMarcador = texto.indexOf("garturlres");
            if (indiceMarcador === -1) return null;

            const trecho = texto.substring(indiceMarcador);
            const urlMatch = trecho.match(/https?:\/\/[^"\\]+/);
            return urlMatch ? urlMatch[0] : null;
        }

        async function decodificarUrl(url) {
            try {
                if (!url.includes("news.google.com")) {
                    return { original: url, resolvido: url };
                }

                const articleId = extrairArticleId(url);
                if (!articleId) return { original: url, resolvido: url };

                const parametros = await obterParametrosDeDecodificacao(articleId);
                if (!parametros) {
                    console.error(`Não foi possível obter assinatura/timestamp para ${articleId}`);
                    return { original: url, resolvido: url };
                }

                const urlResolvida = await chamarBatchExecute(
                    articleId,
                    parametros.timestamp,
                    parametros.signature
                );

                return { original: url, resolvido: urlResolvida || url };
            } catch (err) {
                console.error(`Erro ao decodificar ${url}:`, err.message);
                return { original: url, resolvido: url };
            }
        }

        // Processa em série com um pequeno intervalo entre requisições para reduzir
        // o risco de o Google bloquear por excesso de chamadas simultâneas (HTTP 429).
        const resultados = [];
        for (const url of urls) {
            resultados.push(await decodificarUrl(url));
            await new Promise(r => setTimeout(r, 250));
        }

        return res.status(200).json({ resultados });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
