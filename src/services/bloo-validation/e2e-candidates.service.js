/*
  Serviço responsável por gerar variações possíveis de um E2E.

  Objetivo:
  Quando a API da Bloo não encontra o E2E extraído pelo OCR/Gemini,
  este serviço gera candidatos alternativos trocando caracteres ambíguos.

  Exemplos de ambiguidades:
  - 0, o, O
  - 1, l, I

  Importante:
  Este serviço NÃO decide qual E2E está correto.
  Ele apenas gera possibilidades.

  A decisão final deve vir da API da Bloo:
  - se uma variação bater na API, ela pode ser considerada válida;
  - se nenhuma bater, seguimos para fallback;
  - se mais de uma bater, precisa de revisão.
*/

const GRUPOS_AMBIGUOS = [
  ["0", "o", "O"],
  ["1", "l", "I"]
];

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

function encontrarPosicoesAmbiguas(e2e) {
  const posicoes = [];

  for (let index = 0; index < e2e.length; index++) {
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

  Exemplo:
  E...x00H

  Pode gerar:
  E...x00H
  E...xo0H
  E...x0oH
  E...xooH

  Sempre inclui o E2E original como primeiro candidato.
*/
function gerarCandidatosE2E(e2e) {
  if (typeof e2e !== "string" || !e2e.trim()) {
    return [];
  }

  const e2eNormalizado = e2e.trim();
  const posicoesAmbiguas = encontrarPosicoesAmbiguas(e2eNormalizado);

  if (!posicoesAmbiguas.length) {
    return [e2eNormalizado];
  }

  /*
    Limite de segurança:
    Se houver ambiguidade demais, gerar todas as combinações pode explodir
    rapidamente. Nesse caso, retornamos só o original.
  */
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

  /*
    Garante que o E2E original fique sempre em primeiro lugar.
  */
  const candidatosSemOriginal = candidatos.filter(
    (candidato) => candidato !== e2eNormalizado
  );

  return [e2eNormalizado, ...candidatosSemOriginal];
}

module.exports = {
  gerarCandidatosE2E,
  encontrarPosicoesAmbiguas
};