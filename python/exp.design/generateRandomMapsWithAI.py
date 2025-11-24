import numpy as np
import random
import itertools as it
import json

class NpEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(NpEncoder, self).default(obj)

def calculateGridDis(grid1, grid2):
    gridDis = np.linalg.norm(np.array(grid1) - np.array(grid2), ord=1)
    return gridDis

class CreatRandomMap():
    def __init__(self, dimension):
        self.dimension = dimension

    def __call__(self, condition):
        # Initialize grid corners for player starting positions
        corners = [(0,0), (0,self.dimension-1),
                  (self.dimension-1,0), (self.dimension-1,self.dimension-1)]

        # Randomly select two different corners for players
        player_corners = random.sample(corners, 2)
        initPlayerGrid = player_corners[0]
        initAIGrid = player_corners[1]

        # Get all possible grid positions
        allGrids = tuple(it.product(range(self.dimension), range(self.dimension)))

        # Filter grids that are not player positions
        possibleGrids = list(filter(lambda x: x not in [initPlayerGrid, initAIGrid], allGrids))

        # Select first target position
        target1 = random.choice(possibleGrids)
        possibleGrids.remove(target1)

        # Filter possible positions for second target
        # Ensure minimum distance from first target and roughly equal distance from both players
        possibleGrids2 = list(filter(lambda x:
            calculateGridDis(target1, x) >= condition.minDistanceBetweenTargets and
            abs(calculateGridDis(initPlayerGrid, x) - calculateGridDis(initAIGrid, x)) <= 2,
            possibleGrids))

        # Select second target position
        target2 = random.choice(possibleGrids2)

        return initPlayerGrid, initAIGrid, target1, target2

if __name__ == '__main__':
    # Configuration
    gridSize = 15
    from collections import namedtuple

    # Create random map generator
    createRandomMap = CreatRandomMap(gridSize)

    # Define conditions for map generation
    randomCondition = namedtuple('randomCondition', 'name minDistanceBetweenTargets')
    mapCondition = randomCondition(name='randomMap', minDistanceBetweenTargets=4)

    # Generate maps
    numMaps = 20
    df = {}

    for mapIndex in range(numMaps):
        initPlayerGrid, initAIGrid, target1, target2 = createRandomMap(mapCondition)

        mapData = {
            'mapIndex': mapIndex,
            'initPlayerGrid': initPlayerGrid,
            'initAIGrid': initAIGrid,
            'target1': target1,
            'target2': target2,
            'obstacles': [],  # No obstacles as requested
            'mapType': mapCondition.name,
            'noiseStep': random.sample(range(1, 12), 3)  # Random noise steps
        }

        df[mapIndex] = [mapData]

    # Save practice maps (first 3 maps)
    practice_maps = {i: df[i] for i in range(3)}

    # Save to files
    EXP_CONFIG_FILE = "/Users/chengshaozhe/Documents/stagHunt_single/static/config/randomMapsDataWithAI.js"
    PRACTICE_CONFIG_FILE = "/Users/chengshaozhe/Documents/stagHunt_single/static/config/practiceMapsDataWithAI.js"
    # Save main experiment maps
    with open(EXP_CONFIG_FILE, "w") as f:
        f.write("const config = ")
        json.dump(df, f, indent=4, cls=NpEncoder)
        f.write(";")

    # Save practice maps
    with open(PRACTICE_CONFIG_FILE, "w") as f:
        f.write("const practiceMapsData = ")
        json.dump(practice_maps, f, indent=4, cls=NpEncoder)
        f.write(";")