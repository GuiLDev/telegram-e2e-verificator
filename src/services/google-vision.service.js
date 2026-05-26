const vision = require("@google-cloud/vision");

function criarClienteGoogleVision() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT não definido no arquivo .env");
  }

  console.log("Google Cloud Project:", projectId);
  console.log("Usando Application Default Credentials do gcloud");
  console.log("");

  return new vision.ImageAnnotatorClient({
    projectId
  });
}

async function extrairTextoDaImagem(googleClient, caminhoImagem) {
  const [result] = await googleClient.textDetection(caminhoImagem);

  return result.textAnnotations?.[0]?.description || "";
}

module.exports = {
  criarClienteGoogleVision,
  extrairTextoDaImagem
};