exports.handler = (event, context, callback) => {
    const generateRandom = (maxNumber) => Math.floor(Math.random() * maxNumber) + 1;
    callback(null, {
     "generatedRandomNumber": generateRandom(event.maxNumber),
     "maxNumber": parseInt(event.maxNumber),
     "numberToCheck": parseInt(event.numberToCheck)
    });
  }