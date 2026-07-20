// api-ia.js - Classificação via função serverless (Vercel), com lotes paralelos e resposta compacta (por índice, não por URL)

function relatarErroNaIA(contexto, erro) {
    console.error(`[IA] Erro em ${contexto}:`, erro);
    alert(`[ERRO NA IA]\nFalha em: ${contexto}\nDetalhes: ${erro}`);
}

function montarPrompt(noticias) {
    const listaFormatada = noticias.map((n, i) => {
        const resumoCurto = n.snippet ? n.snippet.substring(0, 200) : "(sem resumo disponível)";
        return `${i}) Título: ${n.titulo}\nResumo: ${resumoCurto}`;
    }).join("\n\n");

    return `Você é um analista especializado em crédito consignado no Brasil. Classifique cada notícia abaixo em uma das três categorias, seguindo estritamente estes critérios:

VIAVEL: notícias que indicam aumento de margem consignável, liberação de novos cartões, aumentos salariais reais de servidores públicos (municipais, estaduais ou federais), novos convênios de consignado abertos, ou decisões judiciais/governamentais que facilitam ou expandem o crédito.

DUVIDOSA: notícias sobre cortes parciais, suspensões temporárias de bancos que não afetam o mercado como um todo, greves gerais em andamento que possam travar o setor temporariamente, ou promessas políticas futuras sem datas definidas e sem aprovação oficial.

INVIAVEL: notícias sobre redução do teto de juros (que afasta os bancos e trava as operações), suspensão definitiva de linhas de crédito, fraudes/golpes descobertas no setor, ou reajustes de categorias que não possuem margem consignável em folha.

Para cada notícia, atribua também uma relevância seguindo esta regra:
- Se a categoria for VIAVEL: dê uma nota de 0 a 100 indicando o quão boa é essa oportunidade (100 = oportunidade excelente e de alto impacto, 0 = oportunidade fraca ou de baixo impacto).
- Se a categoria for DUVIDOSA ou INVIAVEL: a relevância não se aplica. Atribua sempre o valor 0 nesses dois casos.

Notícias para classificar:

${listaFormatada}

Responda APENAS com um array JSON válido, sem blocos de código markdown (como \`\`\`json), sem textos introdutórios e sem explicações, seguindo este formato exato:
[{"url": "...", "categoria": "VIAVEL|DUVIDOSA|INVIAVEL", "relevancia": 0}]`;
}


async function processarLote(lote) {
    const prompt = montarPrompt(lote);

    const resposta = await fetch("/api/classificar-noticias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
    });

    if (!resposta.ok) {
        const corpoErro = await resposta.text();
        throw new Error(`HTTP ${resposta.status}: ${corpoErro}`);
    }

    const data = await resposta.json();
    let textoResposta = data.choices?.[0]?.message?.content;

    if (!textoResposta) {
        throw new Error("A IA não retornou conteúdo classificável.");
    }

    textoResposta = textoResposta.replace(/```json/g, "").replace(/```/g, "").trim();

    const inicioArray = textoResposta.indexOf("[");
    const fimArray = textoResposta.lastIndexOf("]");
    if (inicioArray !== -1 && fimArray !== -1) {
        textoResposta = textoResposta.substring(inicioArray, fimArray + 1);
    }

    let classificacoes;
    try {
        classificacoes = JSON.parse(textoResposta);
    } catch (erroParse) {
        console.error("JSON recebido da IA (inválido):", textoResposta);
        throw new Error(`Falha ao interpretar resposta da IA: ${erroParse.message}\n\nTexto recebido (primeiros 500 caracteres):\n${textoResposta.substring(0, 500)}`);
    }

    let contador = 0;
    for (const item of classificacoes) {
        const noticia = lote[item.indice];
        if (!noticia) continue;

        noticia.categoria = item.categoria;
        noticia.relevancia = item.relevancia;

        await salvarNoticia(noticia);
        contador++;
    }

    return contador;
}

async function classificarNoticiasPendentes() {
    try {
        console.log("Buscando notícias pendentes para classificação...");

        const todasNoticias = await obterTodasNoticias();
        const pendentes = todasNoticias.filter(n => n.categoria === 'PENDENTE');

        if (pendentes.length === 0) {
            console.log("Nenhuma notícia pendente para classificar.");
            return;
        }

        const TAMANHO_LOTE = 5;
        const lotes = [];
        for (let i = 0; i < pendentes.length; i += TAMANHO_LOTE) {
            lotes.push(pendentes.slice(i, i + TAMANHO_LOTE));
        }

        console.log(`Processando ${lotes.length} lote(s) em paralelo...`);

        const resultados = await Promise.allSettled(lotes.map(lote => processarLote(lote)));

        let totalClassificadas = 0;
        let totalErros = 0;

        resultados.forEach((resultado, idx) => {
            if (resultado.status === 'fulfilled') {
                totalClassificadas += resultado.value;
            } else {
                totalErros++;
                console.error(`Erro no lote ${idx + 1}:`, resultado.reason);
            }
        });

        console.log(`[SUCESSO] ${totalClassificadas} notícias classificadas.`);
        if (totalErros > 0) {
            relatarErroNaIA(
                "classificarNoticiasPendentes",
                `${totalErros} lote(s) falharam, mas ${totalClassificadas} notícia(s) foram classificadas normalmente.`
            );
        }

    } catch (error) {
        relatarErroNaIA("classificarNoticiasPendentes", error.message);
    }
}
