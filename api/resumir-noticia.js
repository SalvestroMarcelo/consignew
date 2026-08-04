// api/resumir-noticia.js
// 1) Usa o Jina Reader (https://r.jina.ai) para extrair o conteúdo do artigo.
// 2) Corta o texto em ~3.000 caracteres respeitando o fim da frase/contexto.
// 3) Manda esse texto para a IA (NVIDIA/llama) pedindo um resumo completo,
//    sem limite rígido de frases, priorizando não omitir fatos importantes.
//
// Contrato de resposta:
//   Sucesso: { sucesso: true, resumo: "...", tokensJina: 1234 }
//   Erro:    { sucesso: false, mensagemSimples: "...", erroTecnico: "..." }

const LIMITE_CARACTERES_ALVO = 3000;   // alvo do corte (Pirâmide Invertida)
const MARGEM_PARA_TERMINAR_FRASE = 400; // quanto além do alvo podemos ir pra fechar a ideia
const MAX_TOKENS_RESUMO = 220;          // teto de segurança "Equilibrado"

function mapearErroJina(status, corpoTexto) {
    const tecnico = `HTTP ${status} em r.jina.ai — resposta: ${corpoTexto || "(sem corpo)"}`;

    const mapa = {
        402: "Não foi possível gerar o resumo porque a cota gratuita de leitura de notícias acabou.",
        403: "Não foi possível acessar essa notícia porque o site bloqueou o acesso automático.",
        404: "Não foi possível encontrar essa notícia — o link pode estar quebrado ou a página foi removida.",
        429: "O serviço de leitura está sobrecarregado no momento. Tente novamente em alguns instantes.",
        451: "O site bloqueou esse conteúdo por motivos legais ou regionais.",
        500: "O site da notícia parece estar com problemas no momento.",
        502: "O site da notícia parece estar fora do ar no momento.",
        503: "O site da notícia parece estar fora do ar no momento.",
        504: "O site da notícia demorou demais para responder."
    };

    const mensagemSimples = mapa[status] || "Não foi possível acessar essa notícia agora.";
    return { mensagemSimples, erroTecnico: tecnico };
}

// Corta o texto perto do limite, mas terminando na última frase completa
function cortarRespeitandoContexto(texto, limiteAlvo, margem) {
    if (texto.length <= limiteAlvo) return texto;

    const janela = texto.slice(0, limiteAlvo + margem);
    const finaisDeFrase = [...janela.matchAll(/[.!?]["')\]]?\s/g)];

    if (finaisDeFrase.length === 0) {
        // não achou fim de frase na janela; corta seco mesmo, é o melhor possível
        return janela;
    }

    const ultimo = finaisDeFrase[finaisDeFrase.length - 1];
    const posicaoCorte = ultimo.index + ultimo[0].length;
    return janela.slice(0, posicaoCorte).trim();
}

// Corta o resumo gerado pela IA na última frase completa (usado só se a IA
// bater no teto de tokens e vier cortada no meio de uma ideia)
function cortarResumoTruncado(texto) {
    const finaisDeFrase = [...texto.matchAll(/[.!?]["')\]]?\s/g)];
    if (finaisDeFrase.length === 0) return texto.trim();
    const ultimo = finaisDeFrase[finaisDeFrase.length - 1];
    return texto.slice(0, ultimo.index + ultimo[0].length).trim();
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ sucesso: false, mensagemSimples: "Método não permitido", erroTecnico: "Method not allowed" });
    }

    try {
        const { url, titulo } = req.body;
        if (!url) {
            return res.status(400).json({ sucesso: false, mensagemSimples: "URL não informada", erroTecnico: "Campo 'url' ausente no corpo da requisição" });
        }

        // Checagem prévia: link do Google ainda não resolvido não deve nem tentar
        if (url.includes("news.google.com")) {
            return res.status(422).json({
                sucesso: false,
                mensagemSimples: "Essa notícia ainda não teve o link original identificado. Atualize a lista de notícias e tente de novo.",
                erroTecnico: `URL ainda aponta para news.google.com: ${url}`
            });
        }

        // Etapa 1: extrair o conteúdo do artigo via Jina Reader
        const headersJina = {
            "Accept": "application/json",
            "X-Return-Format": "text" // pede o conteúdo já limpo, sem markdown/links
        };
        if (process.env.JINA_API_KEY) {
            headersJina["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;
        }

        const respostaJina = await fetch(`https://r.jina.ai/${url}`, { headers: headersJina });
        const corpoJinaTexto = await respostaJina.text();

        if (!respostaJina.ok) {
            const { mensagemSimples, erroTecnico } = mapearErroJina(respostaJina.status, corpoJinaTexto);
            return res.status(502).json({ sucesso: false, mensagemSimples, erroTecnico });
        }

        let jsonJina;
        try {
            jsonJina = JSON.parse(corpoJinaTexto);
        } catch (e) {
            return res.status(502).json({
                sucesso: false,
                mensagemSimples: "O serviço de leitura de notícias devolveu uma resposta inesperada.",
                erroTecnico: `Falha ao interpretar JSON do Jina Reader: ${e.message}. Corpo recebido: ${corpoJinaTexto.slice(0, 500)}`
            });
        }

        const tokensJina = jsonJina?.data?.usage?.tokens ?? jsonJina?.usage?.tokens ?? 0;
        const aviso = jsonJina?.data?.warning || jsonJina?.warning;
        let textoArtigo = jsonJina?.data?.text || jsonJina?.data?.content || "";

        if (aviso) {
            return res.status(422).json({
                sucesso: false,
                mensagemSimples: "Não foi possível ler o conteúdo dessa notícia corretamente.",
                erroTecnico: `Aviso do Jina Reader: ${aviso}`,
                tokensJina
            });
        }

        if (!textoArtigo || textoArtigo.trim().length < 200) {
            return res.status(422).json({
                sucesso: false,
                mensagemSimples: "Essa página não trouxe texto suficiente para resumir (pode ser um vídeo, um paywall, ou conteúdo carregado via JavaScript que o leitor automático não consegue ver).",
                erroTecnico: `Conteúdo extraído tinha apenas ${textoArtigo ? textoArtigo.trim().length : 0} caracteres úteis`,
                tokensJina
            });
        }

        textoArtigo = cortarRespeitandoContexto(textoArtigo.trim(), LIMITE_CARACTERES_ALVO, MARGEM_PARA_TERMINAR_FRASE);

        // Etapa 2: pedir o resumo para a IA (mesmo provedor da classificação)
        const prompt = `Resuma a notícia abaixo em português, em no máximo 2-3 frases curtas e diretas — o suficiente para alguém decidir rapidamente se vale a pena ler a notícia completa. Inclua só o essencial (o que mudou, quem é afetado, e valor/prazo somente se for o ponto central da notícia). Corte tudo que for contexto secundário. Não invente informações que não estão no texto.

Título: ${titulo || ""}

Conteúdo:
${textoArtigo}`;

        const respostaIA = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`
            },
            body: JSON.stringify({
                model: "meta/llama-3.1-8b-instruct",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
                max_tokens: MAX_TOKENS_RESUMO
            })
        });

        const dataIA = await respostaIA.json();

        if (!respostaIA.ok) {
            return res.status(502).json({
                sucesso: false,
                mensagemSimples: "A IA responsável por escrever o resumo não respondeu corretamente.",
                erroTecnico: `HTTP ${respostaIA.status} na API da NVIDIA: ${JSON.stringify(dataIA)}`,
                tokensJina
            });
        }

        let resumo = dataIA?.choices?.[0]?.message?.content?.trim();
        const motivoParada = dataIA?.choices?.[0]?.finish_reason;

        if (!resumo) {
            return res.status(502).json({
                sucesso: false,
                mensagemSimples: "A IA não conseguiu gerar um resumo para essa notícia.",
                erroTecnico: `Resposta da NVIDIA sem conteúdo utilizável: ${JSON.stringify(dataIA)}`,
                tokensJina
            });
        }

        if (motivoParada === "length") {
            resumo = cortarResumoTruncado(resumo) + " (resumo pode estar incompleto — a notícia trazia mais detalhes que não couberam aqui)";
        }

        return res.status(200).json({ sucesso: true, resumo, tokensJina });
    } catch (err) {
        return res.status(500).json({
            sucesso: false,
            mensagemSimples: "Ocorreu um erro inesperado ao gerar o resumo.",
            erroTecnico: err.message
        });
    }
}
