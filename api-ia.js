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

    return `Você é um analista sênior especializado no mercado de crédito consignado no Brasil. Sua função é classificar notícias para uma mesa de operações, identificando oportunidades de vendas e mudanças críticas nas regras do mercado.

Classifique cada notícia abaixo em uma das três categorias, seguindo estritamente estes critérios adaptados para a rotina operacional do setor:

VIAVEL: Notícias que indicam aumento direto de receita ou volume de vendas. Inclui: aumento de margem consignável, liberação de novos cartões/benefícios, aumentos salariais reais de servidores (municipais, estaduais ou federais), abertura de novos convênios, ou decisões que facilitam a contratação imediata.

ESTRATEGICA: Notícias sobre mudanças regulatórias, novas regras do governo, pareceres jurídicos/alertas de especialistas sobre leis do setor (como mudanças no consignado CLT ou INSS), e reestruturações que afetam as regras do jogo para todo o mercado. São notícias indispensáveis para a conformidade e orientação do cliente, mesmo que tragam alertas de risco.

INVIAVEL: Notícias sem impacto operacional ou puramente negativas que travam o mercado. Inclui: redução drástica do teto de juros (que afasta bancos), suspensão definitiva de linhas por fraude/golpes, greves gerais prolongadas que paralisam os sistemas, ou reajustes de categorias que sabidamente não possuem margem consignável em folha.

Regra de Relevância (Nota de 0 a 100):
- Para notícias VIAVEL: meça o impacto comercial (100 = explosão de novos contratos/público gigante, 0 = nicho muito pequeno).
- Para notícias ESTRATEGICA: meça a importância da informação para o operador (100 = mudança drástica na lei/regras que todos precisam saber hoje, 0 = aviso burocrático de baixo impacto).
- Para notícias INVIAVEL: a relevância não se aplica. Atribua sempre o valor 0.

Notícias para classificar (numeradas de 0 a ${noticias.length - 1}):

${listaFormatada}

Responda APENAS com um array JSON válido, sem blocos de código markdown (como \`\`\`json), sem textos introdutórios e sem explicações. Use o número do item neste formato exato:
[{"indice": 0, "categoria": "VIAVEL|ESTRATEGICA|INVIAVEL", "relevancia": 0}]`;

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
