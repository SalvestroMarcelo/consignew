// api-ia.js - Classificação via função serverless do Netlify (sem chave exposta, sem proxy externo)

function relatarErroNaIA(contexto, erro) {
    console.error(`[IA] Erro em ${contexto}:`, erro);
    alert(`[ERRO NA IA]\nFalha em: ${contexto}\nDetalhes: ${erro}`);
}

function montarPrompt(noticias) {
    const listaFormatada = noticias.map((n, i) =>
        `${i}) URL: ${n.url}\nTítulo: ${n.titulo}\nResumo: ${n.snippet || "(sem resumo disponível)"}`
    ).join("\n\n");
    return `Você é um analista especializado em crédito consignado no Brasil, focado especificamente em servidores públicos concursados/efetivos (âmbito municipal, estadual ou federal) como público-alvo do produto.

ANTES DE CLASSIFICAR, identifique:
1. O TIPO DE VÍNCULO da categoria profissional mencionada:
   - Servidor público concursado/efetivo (prefeitura, câmara, governo estadual/federal, autarquia, universidade pública, etc.) → RELEVANTE
   - Trabalhador celetista de empresa privada, mesmo que negocie via sindicato, TRT, audiência de conciliação ou esteja em greve (ex: rodoviários de empresas de ônibus) → NÃO RELEVANTE, mesmo que a notícia fale em "reajuste salarial"

2. A ABRANGÊNCIA do benefício/notícia:
   - Amplo, aplicável de forma geral ao público-alvo → considere o impacto pleno
   - Regional, condicional, ou dependente de múltiplas variáveis (estado específico, banco específico, elegibilidade restrita) → trate como incerto/parcial, não pleno

Classifique cada notícia em uma das três categorias, seguindo estritamente estes critérios:

VIAVEL: notícias que indicam aumento de margem consignável, liberação de novos cartões, aumentos salariais REAIS e APROVADOS (não apenas propostos) de servidores públicos concursados (municipais, estaduais ou federais), novos convênios de consignado abertos que sejam amplos e diretamente aplicáveis ao público-alvo geral, ou decisões judiciais/governamentais que facilitam ou expandem o crédito de forma abrangente.

DUVIDOSA: notícias sobre benefícios ou convênios regionais/condicionais que dependem de variáveis específicas (estado, banco, elegibilidade restrita) e não representam ganho direto e geral, cortes parciais, suspensões temporárias de bancos que não afetam o mercado como um todo, greves gerais em andamento que possam travar o setor temporariamente (desde que envolvam o público-alvo de servidores concursados), ou promessas políticas futuras sem datas definidas e sem aprovação oficial.

INVIAVEL: notícias sobre negociações, reajustes, greves ou disputas salariais de trabalhadores CELETISTAS de empresas privadas (ainda que mediadas por TRT, sindicato ou em audiência de conciliação) — pois não afetam o público-alvo de servidores concursados, redução do teto de juros (que afasta os bancos e trava as operações), suspensão definitiva de linhas de crédito, fraudes/golpes descobertas no setor, ou reajustes de categorias que não possuem margem consignável em folha.

EXEMPLOS DE REFERÊNCIA:
1. "Rodoviários e empresas de ônibus do Rio retomam negociação por reajuste salarial em audiência no TRT-RJ" → INVIAVEL (trabalhadores celetistas de empresa privada, não servidores concursados)
2. "Banrisul oferece carência de até seis meses no empréstimo consignado estadual" → DUVIDOSA (benefício regional/condicional, não aplicável de forma geral)
3. "Reajuste salarial de 3,92% para servidores da USP é aprovado pelo Conselho Universitário" → VIAVEL (servidor público, aprovação oficial e efetiva)
4. "Após pressão, governo sinaliza recursos para reajuste salarial em 2027" → DUVIDOSA (promessa futura, sem aprovação oficial ainda)

Para cada notícia, atribua também uma relevância de 0 a 100, indicando o quanto ela realmente impacta o mercado de consignado para servidores públicos concursados (100 = altíssimo impacto, 0 = irrelevante).

Notícias para classificar:
${listaFormatada}

Responda APENAS com um array JSON válido, sem blocos de código markdown (como \`\`\`json), sem textos introdutórios e sem explicações, seguindo este formato exato:
[{"url": "...", "categoria": "VIAVEL|DUVIDOSA|INVIAVEL", "relevancia": 0}]`;
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

        const TAMANHO_LOTE = 5; // processa no máximo 5 notícias por chamada
        let totalClassificadas = 0;

        for (let i = 0; i < pendentes.length; i += TAMANHO_LOTE) {
            const lote = pendentes.slice(i, i + TAMANHO_LOTE);
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

// Extrai só o trecho entre o primeiro [ e o último ] — protege contra texto extra
// que o modelo às vezes adiciona antes/depois do JSON
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

            for (const item of classificacoes) {
                const noticia = lote.find(n => n.url === item.url);
                if (!noticia) continue;

                noticia.categoria = item.categoria;
                noticia.relevancia = item.relevancia;

                await salvarNoticia(noticia);
                totalClassificadas++;
            }
        }

        console.log(`[SUCESSO] ${totalClassificadas} notícias classificadas.`);

    } catch (error) {
        relatarErroNaIA("classificarNoticiasPendentes", error.message);
    }
}
