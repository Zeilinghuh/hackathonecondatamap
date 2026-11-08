                            income_per_head  weekly_pay  inward_fdi  business_deaths  population density  Modelled unemployment Rate
income_per_head                        1.00        0.68        0.29            -0.16                0.34                       -0.18
weekly_pay                             0.68        1.00        0.39             0.10                0.41                       -0.17
inward_fdi                             0.29        0.39        1.00             0.18                0.13                        0.04
business_deaths                       -0.16        0.10        0.18             1.00                0.38                        0.49
population density                     0.34        0.41        0.13             0.38                1.00                        0.45
Modelled unemployment Rate            -0.18       -0.17        0.04             0.49                0.45                        1.00

--Implementation--
-used a function to iterate through different sheets in python
-used dropna and headers to match all years

--Theory--
-Spearman's rank correlation is found in 1-(6 * sigma(squared differences between ranks)/n(n^2-1)
-used spearman's correlation coefficient rather than multilinear regression because we are mapping effects, rather than trying to predict result
-avoids multicollinearity and overfitting issues 
-tracks expected behaviour

--Further Work--
Implement individual relationships to change and flow ecosystem