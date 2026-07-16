// rss-reader.js - Versão via fetch (funciona hospedado em https, inclusive PWA)

const RSS_URL = 'https://news.google.com/rss/search?q=%22empr%C3%A9stimo+consignado%22+OR+%22reajuste+salarial%22+OR+%22Reajuste+salarial+servidores%22+OR+%22margem+consign%C3%A1vel%22&hl=pt-BR&gl=BR&ceid=BR:pt-419';
const RSS2JSON_API_KEY = '7z7tg0enqpufvp94s3qvhsbsznctjpqswlnegfej'; // troque pela chave copiada do painel do rss2json.com

async function atualizarNoticiasDoRSS() {
    console.log("Buscando atualizações via rss2json...");

    const urlProvedor = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(RSS_URL)}&api_key=${RSS2JSON_API_KEY}&count=50`;

    try {
        const resposta = await fetch(urlProvedor);

        if (!resposta.ok) {
            throw new Error(`Falha na requisição HTTP: ${resposta.status}`);
        }

        const data = await resposta.json();

        if (!data || !data.items || data.items.length === 0) {
            console.log("Nenhum dado retornado do feed.");
            return false;
        }

        let novasNoticiasContador = 0;

        for (const item of data.items) {
            const noticia = {
                url: item.link || item.guid,
                titulo: item.title,
                snippet: item.description || item.content || "",
                fonte: item.author || "Google Notícias",
                dataPublicacao: Date.parse(item.pubDate) || Date.now(),
                categoria: "PENDENTE",
                relevancia: 0,
                resumoTexto: null
            };

            if (!noticia.url) continue;

            await salvarNoticia(noticia);
            novasNoticiasContador++;
        }

        console.log(`Processamento concluído: ${novasNoticiasContador} itens.`);
        return true;

    } catch (err) {
        console.error("Erro ao buscar/processar o feed:", err);
        alert("[ERRO DE REDE]\nNão foi possível buscar as notícias.\nDetalhes: " + err.message);
        return false;
    }
}
