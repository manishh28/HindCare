// Security codes are delivered out-of-band. Development logs them locally;
// production must connect this function to an approved email/SMS provider.
function deliverSecurityCode(destination, purpose, code) {
  if (process.env.NODE_ENV === "production") {
    console.log(`[HindCare] Security code generated for ${purpose} (delivery channel not yet configured).`);
    return;
  }
  console.log(`[HindCare][dev-only, never sent over the network] ${purpose} code for ${destination}: ${code}`);
}

module.exports = { deliverSecurityCode };
