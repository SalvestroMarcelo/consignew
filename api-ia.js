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
            const classificacoes = JSON.parse(textoResposta);

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
