const credentialVariableName = /(?:^|_)(?:API_?KEY|ACCESS_?KEY|AUTH(?:ORIZATION|TOKEN)?|CLIENT_?SECRET|CREDENTIALS?|PASSWORD|PASSWD|PRIVATE_?KEY|SECRET|TOKEN)(?:_|$)/i

function containsUrlCredentials(value: string) {
  try {
    const url = new URL(value)
    return Boolean(url.username || url.password)
  } catch {
    return false
  }
}

function isCredentialVariable(name: string, value: string) {
  return credentialVariableName.test(name)
    || /^SSH_AUTH_SOCK$/i.test(name)
    || (/^NPM_CONFIG_/i.test(name) && /(?:_AUTH(?:TOKEN)?|AUTHTOKEN)$/i.test(name))
    || containsUrlCredentials(value)
}

export function createCommandEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const filtered: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || isCredentialVariable(name, value)) continue
    filtered[name] = value
  }
  return filtered
}
