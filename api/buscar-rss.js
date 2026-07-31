// api/buscar-rss.js
// Busca o feed RSS do Google Notícias diretamente do nosso próprio servidor
// (Vercel), sem depender de um proxy de terceiros (rss2json), e converte o
// XML em JSON no mesmo formato que o rss-reader.js já espera.

function decodificarEntidadesXml(texto) {
    return texto
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
}

function extrairTag(blocoXml, tag) {
    const regexCdata = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i");
    const matchCdata = blocoXml.match(regexCdata);
    if (matchCdata) return matchCdata[1].trim();

    const regexSimples = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
    const matchSimples = blocoXml.match(regexSimples);
    return matchSimples ? decodificarEntidadesXml(matchSimples[1].trim()) : "";
}

function converterXmlParaItens(xml) {
    const blocosItem = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

    return blocosItem.map(bloco => ({
        title: extrairTag(bloco, "title"),
        link: extrairTag(bloco, "link"),
        guid: extrairTag(bloco, "guid"),
        pubDate: extrairTag(bloco, "pubDate"),
        description: extrairTag(bloco, "description"),
        content: extrairTag(bloco, "description"),
        author: extrairTag(bloco, "source")
    }));
}

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ status: "error", message: "Método não permitido" });
    }

    try {
        const { rss_url } = req.query;
        if (!rss_url) {
            return res.status(400).json({ status: "error", message: "Parâmetro 'rss_url' não informado" });
        }

        const resposta = await fetch(rss_url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }
        });

        if (!resposta.ok) {
            return res.status(502).json({
                status: "error",
                message: `O Google Notícias retornou HTTP ${resposta.status} ao buscar o feed`
            });
        }

        const xml = await resposta.text();
        const items = converterXmlParaItens(xml);

        if (items.length === 0) {
            return res.status(422).json({
                status: "error",
                message: "O feed foi lido, mas nenhuma notícia foi encontrada nele (formato inesperado ou feed vazio)"
            });
        }

        return res.status(200).json({ status: "ok", items });
    } catch (err) {
        return res.status(500).json({ status: "error", message: err.message });
    }
}
