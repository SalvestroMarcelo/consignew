// rss-reader.js - Busca RSS com deduplicação e retry automático
const RSS_URL = 'https://news.google.com/rss/search?q=empr%C3%A9stimo+consignado+OR+reajuste+salarial+OR+margem+consign%C3%A1vel&hl=pt-BR&gl=BR&ceid=BR:pt-419';
const RSS2JSON_API_KEY = '7z7tg0enqpufvp94s3qvhsbsznctjpqswlnegfej';
const MAX_TENTATIVAS = 3;

function normalizarTitulo(titulo) {
    return titulo
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\s-\s[^-]+$/, "")
        .replace(/[^\w\s]/g, "")
        .trim();
}

function similaridadeTitulos(a, b) {
    const palavrasA = new Set(a.split(/\s+/).filter(p => p.length > 3));
    const palavrasB = new Set(b.split(/\s+/).filter(p => p.length > 3));
    if (palavrasA.size === 0 || palavrasB.size === 0) return 0;
    let intersecao = 0;
    palavrasA.forEach(p => { if (palavrasB.has(p)) intersecao++; });
    const uniao = new Set([...palavrasA, ...palavrasB]).size;
    return intersecao / uniao;
}

const LIMITE_SIMILARIDADE = 0.6;

async function resolverUrlsOriginais(urls) {
    try {
        const resposta = await fetch("/api/resolve-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls })
        });
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        const data = await resposta.json();
        return data.resultados || [];
    } catch (err) {
        console.error("Erro ao resolver URLs:", err);
        return urls.map(url => ({ original: url, resolvido: url }));
    }
}

async function buscarFeedRSS() {
    const urlProvedor = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(RSS_URL)}&api_key=${RSS2JSON_API_KEY}&count=20`;
    
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        try {
            console.log(`Buscando RSS (tentativa ${tentativa}/${MAX_TENTATIVAS})...`);
            const resposta = await fetch(urlProvedor);
            
            if (!resposta.ok) {
                throw new Error(`HTTP ${resposta.status}`);
            }
            
            const data = await resposta.json();
            if (!data || !data.items || data.items.length === 0) {
                throw new Error("Feed vazio");
            }
            
            return data; // Sucesso!
        } catch (err) {
            console.warn(`Falha na tentativa ${tentativa}: ${err.message}`);
            if (tentativa < MAX_TENTATIVAS) {
                const espera = tentativa * 2000; // 2s, 4s, 6s
                console.log(`Aguardando ${espera/1000}s antes de tentar novamente...`);
                await new Promise(r => setTimeout(r, espera));
            } else {
                throw err; // Falhou todas as tentativas
            }
        }
    }
}

async function atualizarNoticiasDoRSS() {
    console.log("Iniciando busca de notícias...");
    
    try {
        const data = await buscarFeedRSS();
        
        const existentes = await obterTodasNoticias();
        const titulosConhecidos = existentes.map(n => normalizarTitulo(n.titulo));
        
        let novasNoticiasContador = 0;
        let duplicatasIgnoradas = 0;
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
            
            noticiasNovas.push({
                url: url,
                titulo: item.title,
                snippet: item.description || item.content || "",
                fonte: item.author || "Google Notícias",
                dataPublicacao: Date.parse(item.pubDate) || Date.now(),
                categoria: "PENDENTE",
                relevancia: 0,
                resumoTexto: null
            });
            titulosConhecidos.push(tituloNormalizado);
        }
        
        if (noticiasNovas.length > 0) {
            console.log(`Resolvendo URLs de ${noticiasNovas.length} notícia(s) nova(s)...`);
            const urlsParaResolver = noticiasNovas.map(n => n.url);
            const resultados = await resolverUrlsOriginais(urlsParaResolver);
            
            resultados.forEach((resultado, indice) => {
                if (noticiasNovas[indice]) {
                    noticiasNovas[indice].url = resultado.resolvido;
                }
            });
            
            for (const noticia of noticiasNovas) {
                try {
                    await salvarNoticia(noticia);
                    novasNoticiasContador++;
                } catch (erroSalvamento) {
                    console.error(`Erro ao salvar "${noticia.titulo}":`, erroSalvamento);
                }
            }
        }
        
        console.log(`Processamento concluído: ${novasNoticiasContador} novos, ${duplicatasIgnoradas} duplicatas.`);
        return true;
        
    } catch (err) {
        console.error("Erro fatal ao buscar feed:", err);
        alert("[ERRO DE REDE]\nNão foi possível buscar as notícias após várias tentativas.\nDetalhes: " + err.message);
        return false;
    }
}
