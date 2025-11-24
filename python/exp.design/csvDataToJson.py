import numpy as np
import fire
import random
from copy import deepcopy
import os, sys, json
import pandas as pd

OBJECT = {
  'blank': 0,
  'obstacle': 1,
  'player': 2,
  'goal': 9,
  'fixPoint':5,
}


class NpEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(NpEncoder, self).default(obj)

if __name__ == '__main__':
    df = pd.read_csv( '/Users/chengshaozhe/osfIntentionRegulatesDesires/Exp2/data/Exp2DataWithBlock.csv')
    # df = pd.read_csv('mapsData.csv')

    # print(df.())
    # zz
    # df = df[df.blockIndex == 3]
    df = df[(df['targetDiff'] == '0')]  # main result
    # df = df[(df['conditionName'] == 'expCondition')]
    df = df.sample(2)

    df['playerGrid'] = df.apply(lambda x : eval(x['playerGrid']), axis=1)
    df['obstacles'] = df.apply(lambda x : eval(x['obstacles']), axis=1)
    df['target1'] = df.apply(lambda x : eval(x['target1']), axis=1)
    df['target2'] = df.apply(lambda x : eval(x['target2']), axis=1)
    df['noisePoint'] = df.apply(lambda x : eval(x['noisePoint']), axis=1)

    # print(df.playerGrid.to_list())
    # zz
    experiment = {
                    "initAgent": df.playerGrid.to_list(),
                    "obstacle": df.obstacles.to_list(),
                    "target1": df.target1.to_list(),
                    "target2": df.target2.to_list(),
                    'mapType': df.conditionName.to_list(),
                    "noisePoint": df.noisePoint.to_list(),
                    # "stepsToCrossRoadList": stepsToCrossRoadList,
                    # "nTrials": nTrials
                    }

    EXP_CONFIG_FILE = "../static/config/configExpFromCsv.js"
    json.dump(
        experiment,
        open(EXP_CONFIG_FILE, "w"),
        indent=4,
        cls=NpEncoder
    )