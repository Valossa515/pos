# Downloader de materiais da pós (MBA USP/Esalq - Pecege)

Baixa os materiais de todas as aulas de https://classicdashboard.mbx.academy/
para pastas `Pos/Aula NN - data - nome/`.

## Como atualizar (pegar materiais novos)

```bash
cd ~/Pos/_downloader
npm install                 # 1ª vez apenas
npx playwright install chromium  # 1ª vez apenas
node login.js               # abre navegador -> faça login manualmente
node list-classes.js        # atualiza a lista de aulas (loadcards.json -> classes.json)
node download.js            # baixa só o que ainda não existe (skip nos já baixados)
```

Editar `DEST` em download.js se quiser mudar a pasta de destino.
Aulas ainda não ministradas aparecem em classes.json mas dão `[ERRO página] waitForResponse:
Timeout` no download — é esperado, elas ainda não têm materiais publicados.
Aulas sem materiais: Boas-vindas, Palestra Dimensões Socio-Emocionais, Prova dos Vídeos do TCC.
