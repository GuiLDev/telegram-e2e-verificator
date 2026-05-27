/*
  Serviço responsável por gerar variações possíveis de um E2E.

  Objetivo:
  Quando a API da Bloo não encontra o E2E extraído pelo OCR/Gemini,
  este serviço gera candidatos alternativos para tentar recuperar o E2E correto.

  Camadas de candidatos:
  1. Ambiguidade visual:
     - 0 / o / O
     - 1 / l / I
     - 5 / s / S
     - 6 / s / S / G
     - 8 / B

  2. Recuperação estrutural:
     - casos onde o OCR mistura o botão "Copiar" com o E2E;
     - casos onde o último caractere do E2E aparece sozinho na linha de baixo.

  3. Recuperação por maiúscula/minúscula:
     - casos onde o OCR lê "X" mas o correto é "x";
     - ou lê "x" mas o correto é "X".

  Importante:
  Este serviço NÃO decide qual E2E está correto.
  Ele apenas gera possibilidades.
  A decisão final vem da API da Bloo.
*/

const TAMANHO_E2E = 32;
const INDICE_INICIO_SUFIXO_E2E = 17;

const LIMITE_MAXIMO_CANDIDATOS = 128;
const LIMITE_MAXIMO_CARACTERES_AMBIGUOS = 5;

const E2E_EXATO_REGEX = /^[ED]\d{8}\d{8}[A-Za-z0-9]{15}$/;
const E2E_EXATO_GLOBAL_REGEX = /[ED]\d{8}\d{8}[A-Za-z0-9]{15}/g;

const MAPA_AMBIGUIDADES = {
  "0": ["0", "o", "O"],
  o: ["o", "0", "O"],
  O: ["O", "0", "o"],

  "1": ["1", "l", "I"],
  l: ["l", "1", "I"],
  I: ["I", "1", "l"],

  "5": ["5", "s", "S"],
  s: ["s", "5", "S", "6"],
  S: ["S", "5", "s", "6"],

  "6": ["6", "s", "S", "G"],
  G: ["G", "6"],

  "8": ["8", "B"],
  B: ["B", "8"]
};

function candidatoTemFormatoE2E(candidato) {
  return typeof candidato === "string" && E2E_EXATO_REGEX.test(candidato);
}

function limiteDeCandidatosAtingido(candidatos) {
  return candidatos.length >= LIMITE_MAXIMO_CANDIDATOS;
}

function adicionarCandidato(candidatos, candidato) {
  if (limiteDeCandidatosAtingido(candidatos)) {
    return;
  }

  if (!candidatoTemFormatoE2E(candidato)) {
    return;
  }

  if (!candidatos.includes(candidato)) {
    candidatos.push(candidato);
  }
}

function adicionarCandidatos(candidatos, novosCandidatos) {
  for (const candidato of novosCandidatos) {
    adicionarCandidato(candidatos, candidato);

    if (limiteDeCandidatosAtingido(candidatos)) {
      break;
    }
  }
}

function limparLinhaParaCandidato(linha) {
  if (!linha) return "";

  return linha
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function removerRuidosDeAcao(linhaLimpa) {
  if (!linhaLimpa) return "";

  return linhaLimpa
    .replace(/copiar/gi, "")
    .replace(/copiado/gi, "")
    .replace(/copy/gi, "");
}

function obterVariacoesDoCaractere(caractere) {
  return MAPA_AMBIGUIDADES[caractere] || [caractere];
}

function caractereEhLetra(caractere) {
  return /^[A-Za-z]$/.test(caractere);
}

function inverterCase(caractere) {
  if (caractere === caractere.toUpperCase()) {
    return caractere.toLowerCase();
  }

  return caractere.toUpperCase();
}

/*
  Encontra posições ambíguas somente no sufixo alfanumérico.

  Não mexemos na parte:
  E/D + 16 dígitos

  Motivo:
  A parte inicial tem muitos números e geraria candidatos demais.
  O sufixo é onde o OCR costuma confundir letras e números.
*/
function encontrarPosicoesAmbiguas(e2e) {
  const posicoes = [];

  for (let index = INDICE_INICIO_SUFIXO_E2E; index < e2e.length; index++) {
    const caractere = e2e[index];

    if (MAPA_AMBIGUIDADES[caractere]) {
      posicoes.push({
        index,
        caractere,
        variacoes: MAPA_AMBIGUIDADES[caractere]
      });
    }
  }

  return posicoes;
}

/*
  Gera candidatos por troca de caracteres ambíguos.

  Exemplo:
  OCR:
  E00416968202605262046tXxHSG7Giho

  Pode gerar:
  E00416968202605262046tXxHSG7GihO
  E00416968202605262046tXxHSG7Gih0
*/
function gerarCandidatosPorAmbiguidade(e2e) {
  if (!candidatoTemFormatoE2E(e2e)) {
    return [];
  }

  const posicoesAmbiguas = encontrarPosicoesAmbiguas(e2e);

  if (!posicoesAmbiguas.length) {
    return [e2e];
  }

  const posicoesLimitadas = posicoesAmbiguas.slice(
    -LIMITE_MAXIMO_CARACTERES_AMBIGUOS
  );

  let candidatos = [e2e];

  for (const posicao of posicoesLimitadas) {
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

  return candidatos.filter(candidatoTemFormatoE2E);
}

/*
  Gera candidatos trocando maiúscula/minúscula de UMA letra por vez.

  Isso evita explosão de combinações.

  Exemplo:
  OCR:
  E22896431202605271325HXJFZS1mz2n

  Pode gerar:
  E22896431202605271325hXJFZS1mz2n
  E22896431202605271325HxJFZS1mz2n
  E22896431202605271325HXjFZS1mz2n

  O candidato só será aceito se a Bloo confirmar.
*/
function gerarCandidatosPorTrocaDeCase(e2e) {
  const candidatos = [];

  if (!candidatoTemFormatoE2E(e2e)) {
    return candidatos;
  }

  for (let index = INDICE_INICIO_SUFIXO_E2E; index < e2e.length; index++) {
    const caractere = e2e[index];

    if (!caractereEhLetra(caractere)) {
      continue;
    }

    const caracteres = e2e.split("");
    caracteres[index] = inverterCase(caractere);

    adicionarCandidato(candidatos, caracteres.join(""));
  }

  return candidatos;
}

/*
  Gera candidatos estruturais usando o texto bruto do OCR.

  Resolve casos como:

  E18236120202605191656s114822887 Copiar
  6

  O OCR pode capturar:
  E18236120202605191656s114822887C

  Mas o candidato estrutural correto pode ser:
  E18236120202605191656s1148228876
*/
function gerarCandidatosEstruturaisPorTexto(e2e, textoOCR) {
  const candidatos = [];

  if (!textoOCR || typeof textoOCR !== "string") {
    return candidatos;
  }

  if (!e2e || typeof e2e !== "string") {
    return candidatos;
  }

  const e2eNormalizado = e2e.trim();

  const linhas = textoOCR
    .split(/\r?\n/)
    .map((linha) => ({
      original: linha,
      limpa: limparLinhaParaCandidato(linha)
    }))
    .filter((linha) => linha.limpa);

  const prefixoForte = e2eNormalizado.slice(0, 20);

  for (let index = 0; index < linhas.length; index++) {
    const linhaAtual = linhas[index];

    const linhaSemRuido = removerRuidosDeAcao(linhaAtual.limpa);

    const linhaTemRuidoDeAcao = linhaAtual.limpa !== linhaSemRuido;

    const linhaRelacionadaAoE2E =
      linhaAtual.limpa.includes(e2eNormalizado) ||
      linhaAtual.limpa.includes(e2eNormalizado.slice(0, -1)) ||
      linhaSemRuido.includes(prefixoForte);

    if (!linhaTemRuidoDeAcao && !linhaRelacionadaAoE2E) {
      continue;
    }

    for (let offset = 1; offset <= 2; offset++) {
      const proximaLinha = linhas[index + offset];

      if (!proximaLinha) {
        continue;
      }

      const complemento = proximaLinha.limpa;

      if (!/^[A-Za-z0-9]{1,3}$/.test(complemento)) {
        continue;
      }

      const combinadoSemRuido = `${linhaSemRuido}${complemento}`;
      const encontrados = combinadoSemRuido.match(E2E_EXATO_GLOBAL_REGEX) || [];

      for (const encontrado of encontrados) {
        adicionarCandidato(candidatos, encontrado);
      }

      if (e2eNormalizado.length === TAMANHO_E2E) {
        const candidatoPorSubstituicao =
          e2eNormalizado.slice(0, TAMANHO_E2E - complemento.length) +
          complemento;

        adicionarCandidato(candidatos, candidatoPorSubstituicao);
      }
    }
  }

  return candidatos;
}

/*
  Função principal.

  Ordem dos candidatos:
  1. E2E original.
  2. Candidatos estruturais.
  3. Candidatos por troca de maiúscula/minúscula.
  4. Candidatos por ambiguidade visual.

  A Bloo decide qual deles é válido.
*/
function gerarCandidatosE2E(e2e, opcoes = {}) {
  if (typeof e2e !== "string" || !e2e.trim()) {
    return [];
  }

  const e2eNormalizado = e2e.trim();

  if (!candidatoTemFormatoE2E(e2eNormalizado)) {
    return [e2eNormalizado];
  }

  const candidatos = [];

  adicionarCandidato(candidatos, e2eNormalizado);

  const candidatosEstruturais = gerarCandidatosEstruturaisPorTexto(
    e2eNormalizado,
    opcoes.textoOCR
  );

  adicionarCandidatos(candidatos, candidatosEstruturais);

  const basesParaCase = [...candidatos];

  for (const base of basesParaCase) {
    adicionarCandidatos(candidatos, gerarCandidatosPorTrocaDeCase(base));

    if (limiteDeCandidatosAtingido(candidatos)) {
      return candidatos;
    }
  }

  const basesParaAmbiguidade = [...candidatos];

  for (const base of basesParaAmbiguidade) {
    adicionarCandidatos(candidatos, gerarCandidatosPorAmbiguidade(base));

    if (limiteDeCandidatosAtingido(candidatos)) {
      return candidatos;
    }
  }

  return candidatos;
}

module.exports = {
  gerarCandidatosE2E,
  encontrarPosicoesAmbiguas,
  gerarCandidatosEstruturaisPorTexto,
  gerarCandidatosPorTrocaDeCase
};