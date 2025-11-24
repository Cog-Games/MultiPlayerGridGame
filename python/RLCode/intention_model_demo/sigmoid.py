import numpy as np


def sigmoidScale(x, intensity=30, threshold=0.2):
    return 1 / (1 + np.exp(- intensity * (x - threshold)))


class CalPerceivedIntentions:
    def __init__(self, intensity, threshold):
        self.intensity = intensity
        self.threshold = threshold

    def __call__(self, bayesIntentions):
        a, b = bayesIntentions
        diff = abs(a - b)
        perceivedDiff = sigmoidScale(diff, self.intensity, self.threshold)

        if a > b:
            aNew = (perceivedDiff + 1) / 2
        else:
            aNew = (1 - perceivedDiff) / 2

        perceivedIntentions = [aNew, 1 - aNew]
        return perceivedIntentions


if __name__ == '__main__':
    intensity, threshold = 30, 0.2
    calPerceivedIntentions = CalPerceivedIntentions(intensity, threshold)
    p = 0.6
    bayesIntentions = [1 - p, p]
    perceivedIntentions = calPerceivedIntentions(bayesIntentions)
    print(perceivedIntentions)

    # print(sigmoidScale(0.01))
