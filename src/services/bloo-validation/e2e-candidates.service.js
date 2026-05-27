/*
  Serviço responsável por gerar variações possíveis de um E2E.

  Objetivo:
  Quando a API da Bloo não encontra o E2E extraído pelo OCR/Gemini,
  este serviço gera candidatos alternativos trocando caracteres ambíguos.

  Importante:
  A geração de candidatos acontece apenas no sufixo alfanumérico do E2E.

  Estrutura considerada:
  - posição 0: E ou D
  - posições 1 até 16: parte numérica fixa
  - posição 17 em diante: sufixo alfanumérico

  Motivo:
  A parte numérica inicial costuma ter muitos 0 e 1.
  Se gerarmos variações nela, criamos combinações demais e falsos positivos.
*/

const GRUPOS_AMBIGUOS = [
  ["0", "o", "O"],
  ["1", "l", "I"]
];

const INDICE_INICIO_SUFIXO_E2E = 17;
const LIMITE_MAXIMO_CANDIDATOS = 64;
const LIMITE_MAXIMO_CARACTERES_AMBIGUOS = 5;

function encontrarGrupoAmbiguo(caractere) {
  return GRUPOS_AMBIGUOS.find((grupo) => grupo.includes(caractere)) || null;
}

function obterVariacoesDoCaractere(caractere) {
  const grupo = encontrarGrupoAmbiguo(caractere);

  if (!grupo) {
    return [caractere];
  }

  return grupo;
}

/*
  Encontra posições ambíguas apenas no sufixo alfanumérico.

  Exemplo:
  E00416968202605262046tXxHSG7Giho

  Parte fixa:
  E0041696820260526

  Parte analisada:
  2046tXxHSG7Giho
*/
function encontrarPosicoesAmbiguas(e2e) {
  const posicoes = [];

  for (let index = INDICE_INICIO_SUFIXO_E2E; index < e2e.length; index++) {
    const caractere = e2e[index];
    const grupo = encontrarGrupoAmbiguo(caractere);

    if (grupo) {
      posicoes.push({
        index,
        caractere,
        variacoes: grupo
      });
    }
  }

  return posicoes;
}

/*
  Gera combinações controladas do E2E.

  Sempre inclui o E2E original como primeiro candidato.

  Exemplo:
  OCR:
  E00416968202605262046tXxHSG7Giho

  Pode gerar:
  E00416968202605262046tXxHSG7Giho
  E00416968202605262046tXxHSG7GihO
  E00416968202605262046tXxHSG7Gih0
  ...
*/
function gerarCandidatosE2E(e2e) {
  if (typeof e2e !== "string" || !e2e.trim()) {
    return [];
  }

  const e2eNormalizado = e2e.trim();

  if (e2eNormalizado.length <= INDICE_INICIO_SUFIXO_E2E) {
    return [e2eNormalizado];
  }

  const posicoesAmbiguas = encontrarPosicoesAmbiguas(e2eNormalizado);

  if (!posicoesAmbiguas.length) {
    return [e2eNormalizado];
  }

  if (posicoesAmbiguas.length > LIMITE_MAXIMO_CARACTERES_AMBIGUOS) {
    return [e2eNormalizado];
  }

  let candidatos = [e2eNormalizado];

  for (const posicao of posicoesAmbiguas) {
    const novosCandidatos = [];

    for (const candidatoAtual of candidatos) {
      for (const variacao of obterVariacoesDoCaractere(posicao.caractere)) {
        const caracteres = candidatoAtual.split("");
        caracteres[posicao.index] = variacao;

        novosCandidatos.push(caracteres.join(""));
      }
    }

    candidatos = [...new Set(novosCandidatos)];

    if (candidatos.length > LIMITE_MAXIMO_CANDIDATOS) {
      candidatos = candidatos.slice(0, LIMITE_MAXIMO_CANDIDATOS);
      break;
    }
  }

  const candidatosSemOriginal = candidatos.filter(
    (candidato) => candidato !== e2eNormalizado
  );

  return [e2eNormalizado, ...candidatosSemOriginal];
}

module.exports = {
  gerarCandidatosE2E,
  encontrarPosicoesAmbiguas
};