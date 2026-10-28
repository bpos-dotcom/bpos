const { detectPlatform } = require("./platform-detector");

const parseDidi = require("./parsers/didi");
const parseUber = require("./parsers/uber");
const parseRappi = require("./parsers/rappi");
const parseGeneric = require("./parsers/generic");

function parseTicket(text) {
  const platform = detectPlatform(text);

  let parsed;

  switch (platform) {
    case "didi":
      parsed = parseDidi(text);
      break;

    case "uber":
      parsed = parseUber(text);
      break;

    case "rappi":
      parsed = parseRappi(text);
      break;

    default:
      parsed = parseGeneric(text);
      break;
  }

  parsed.platform = platform === "unknown" ? "otro" : platform;

  return parsed;
}

module.exports = {
  parseTicket,
};