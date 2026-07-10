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

            const resposta = await fetch("/.netlify/functions/classificar-noticias", {
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
