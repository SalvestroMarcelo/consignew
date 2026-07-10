// api-ia.js - Classificação via função serverless do Netlify (sem chave exposta, sem proxy externo)

function relatarErroNaIA(contexto, erro) {
    console.error(`[IA] Erro em ${contexto}:`, erro);
    alert(`[ERRO NA IA]\nFalha em: ${contexto}\nDetalhes: ${erro}`);
}

function montarPrompt(noticias) {
    const listaFormatada = noticias.map((n, i) =>
        `${i}) URL: ${n.url}\nTítulo: ${n.titulo}\nResumo: ${n.snippet || "(sem resumo disponível)"}`
    ).join("\n\n");

    return `Você é um analista especializado em crédito consignado no Brasil. Classifique cada notícia abaixo em uma das três categorias, seguindo estritamente estes critérios:

VIAVEL: notícias que indicam aumento de margem consignável, liberação de novos cartões, aumentos salariais reais de servidores públicos (municipais, estaduais ou federais), novos convênios de consignado abertos, ou decisões judiciais/governamentais que facilitam ou expandem o crédito.

DUVIDOSA: notícias sobre cortes parciais, suspensões temporárias de bancos que não afetam o mercado como um todo, greves gerais em andamento que possam travar o setor temporariamente, ou promessas políticas futuras sem datas definidas e sem aprovação oficial.

INVIAVEL: notícias sobre redução do teto de juros (que afasta os bancos e trava as operações), suspensão definitiva de linhas de crédito, fraudes/golpes descobertas no setor, ou reajustes de categorias que não possuem margem consignável em folha.

Para cada notícia, atribua também uma relevância de 0 a 100, indicando o quanto ela realmente impacta o mercado de consignado (100 = altíssimo impacto, 0 = irrelevante).

Notícias para classificar:

${listaFormatada}

Responda APENAS com um array JSON válido, sem blocos de código markdown (como \`\`\`json), sem textos introdutórios e sem explicações, seguindo este formato exato:
[{"url": "...", "categoria": "VIAVEL|DUVIDOSA|INVIAVEL", "relevancia": 0}]`;
}

async function classificarNoticiasPendentes() {
    try {
        console.log("Buscando notícias pendentes para classificação...");

        const todasNoticias = await
