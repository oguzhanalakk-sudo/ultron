/** Open an external link through Electron's main process and return the real result. */
export async function openUrlInBrowser(url: string): Promise<boolean> {
  try {
    return await window.kodAtolyesi.openUrlInBrowser(url) === true
  } catch {
    return false
  }
}
