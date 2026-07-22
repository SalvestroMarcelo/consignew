// rss-reader.js - Busca RSS com deduplicação por título similar (entre fontes diferentes)
const RSS_URL = 'https://news.google.com/rss/search?q=%22empr%C3%A9stimo+consignado%22+OR+%22reajuste+salarial%22+OR+%22Reajuste+salarial+servidores%22+OR+%22margem+consign%C3%A1vel%22&hl=pt-BR&gl=BR&ceid=BR:pt-419';
const RSS2JSON_API_KEY = '7z7tg0enqpufvp94s3qvhsbsznctjpqswlnegfej';

// Remove acentos, pontuação, caixa alta e o sufixo "- Nome do Site" do final do título,
// pra sobrar só o "miolo" comparável do título.
function normalizarTitulo(titulo) {
    return titulo
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\s-\s[^-]+$/, "")
        .replace(/[^\w\s]/g, "")
        .trim();
}

// Similaridade por sobreposição de palavras (Jaccard). Ignora palavras curtas
// (artigos, preposições) pra focar no conteúdo relevante do título.
function similaridadeTitulos(a, b) {
    const palavrasA = new Set(a.split(/\s+/).filter(p => p.length > 3));
    const palavrasB = new Set(b.split(/\s+/).filter(p => p.length > 3));
    if (palavrasA.size === 0 || palavrasB.size === 0) return 0;
    let intersecao = 0;
    palavrasA.forEach(p => { if (palavrasB.has(p)) intersecao++; });
    const uniao = new Set([...palavrasA, ...palavrasB]).size;
    return intersecao / uniao;
}

const LIMITE_SIMILARIDADE = 0.6; // 60% das palavras em comum = considera duplicata

// NOVO: Função para resolver URLs do Google News para URLs originais
async function resolverUrlsOriginais(urls) {
    try {
        const resposta = await fetch("/api/resolve-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls })
        });

        if (!resposta.ok) {
            throw new Error(`HTTP ${resposta.status}`);
        }

        const data = await resposta.json();
        return data.resultados || [];
    } catch (err) {
        console.error("Erro ao resolver URLs:", err);
        // Fallback: retorna as URLs originais sem resolução
        return urls.map(url => ({ original: url, resolvido: url }));
    }
}

async function atualizarNoticiasDoRSS() {
    console.log("Buscando atualizações via rss2json...");
    const urlProvedor = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(RSS_URL)}&api_key=${RSS2JSON_API_KEY}&count=20`;

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

        // Carrega os títulos já existentes no banco (normalizados) pra comparar
        const existentes = await obterTodasNoticias();
        const titulosConhecidos = existentes.map(n => normalizarTitulo(n.titulo));

        let novasNoticiasContador = 0;
        let duplicatasIgnoradas = 0;

        // Coleta todas as notícias novas primeiro (sem salvar ainda)
        const noticiasNovas = [];
        
        for (const item of data.items) {
            const url = item.link || item.guid;
            if (!url) continue;

            const tituloNormalizado = normalizarTitulo(item.title);
            const jaExisteSimilar = titulosConhecidos.some(
                t => similaridadeTitulos(t, tituloNormalizado) >= LIMITE_SIMILARIDADE
            );

            if (jaExisteSimilar) {
                duplicatasIgnoradas++;
                continue;
            }

            const noticia = {
                url: url, // URL do Google News temporariamente
                titulo: item.title,
                snippet: item.description || item.content || "",
                fonte: item.author || "Google Notícias",
                dataPublicacao: Date.parse(item.pubDate) || Date.now(),
                categoria: "PENDENTE",
                relevancia: 0,
                resumoTexto: null
            };
            
            noticiasNovas.push(noticia);
            titulosConhecidos.push(tituloNormalizado); // evita duplicata dentro do mesmo lote também
        }

        // NOVO: Se há notícias novas, resolve as URLs em lote
        if (noticiasNovas.length > 0) {
            console.log(`Resolvendo URLs de ${noticiasNovas.length} notícia(s) nova(s)...`);
            
            const urlsParaResolver = noticiasNovas.map(n => n.url);
            const resultados = await resolverUrlsOriginais(urlsParaResolver);
            
            // Atualiza cada notícia com a URL resolvida
            resultados.forEach((resultado, indice) => {
                if (noticiasNovas[indice]) {
                    noticiasNovas[indice].url = resultado.resolvido;
                }
            });
            
            // Agora salva todas as notícias com as URLs originais
            for (const noticia of noticiasNovas) {
                await salvarNoticia(noticia);
                novasNoticiasContador++;
            }
        }

        console.log(`Processamento concluído: ${novasNoticiasContador} itens novos, ${duplicatasIgnoradas} duplicata(s) ignorada(s).`);
        return true;

    } catch (err) {
        console.error("Erro ao buscar/processar o feed:", err);
        alert("[ERRO DE REDE]\nNão foi possível buscar as notícias.\nDetalhes: " + err.message);
        return false;
    }
}
